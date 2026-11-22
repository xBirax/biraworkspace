//! User Temp cleanup. Every deletion uses an exclusive file handle, while
//! ancestor directory handles are held without delete sharing.
//! The preview digest binds paths to file identities; apply repeats the scan.

use serde_json::{json, Value};
use sha2::{Digest, Sha256};
#[cfg(test)]
use std::env;
use std::ffi::OsStr;
#[cfg(not(test))]
use std::ffi::OsString;
use std::fs;
use std::io;
use std::os::windows::ffi::OsStrExt;
#[cfg(not(test))]
use std::os::windows::ffi::OsStringExt;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const MAX_ITEMS: usize = 100_000;
const MAX_TIME: Duration = Duration::from_secs(60);
const MIN_AGE: Duration = Duration::from_secs(7 * 24 * 60 * 60);
const FILE_READ_ATTRIBUTES: u32 = 0x00000080;
const DELETE: u32 = 0x00010000;
const FILE_SHARE_READ: u32 = 0x00000001;
const FILE_SHARE_WRITE: u32 = 0x00000002;
const OPEN_EXISTING: u32 = 3;
const FILE_ATTRIBUTE_DIRECTORY: u32 = 0x00000010;
const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x00000400;
const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x00200000;
const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x02000000;
const FILE_DISPOSITION_INFO_CLASS: u32 = 4;

type Handle = isize;
const INVALID_HANDLE: Handle = -1;

#[cfg(not(test))]
#[repr(C)]
struct Guid {
    one: u32,
    two: u16,
    three: u16,
    four: [u8; 8],
}
#[cfg(not(test))]
const LOCAL_APP_DATA: Guid = Guid {
    one: 0xF1B32785,
    two: 0x6FBA,
    three: 0x4FCF,
    four: [0x9D, 0x55, 0x7B, 0x8E, 0x7F, 0x15, 0x70, 0x91],
};

#[repr(C)]
#[derive(Clone, Copy)]
struct FileTime {
    low: u32,
    high: u32,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct FileInfo {
    attributes: u32,
    created: FileTime,
    accessed: FileTime,
    modified: FileTime,
    volume: u32,
    size_high: u32,
    size_low: u32,
    links: u32,
    file_index_high: u32,
    file_index_low: u32,
}

#[repr(C)]
struct Disposition {
    delete_file: u8,
}

#[link(name = "kernel32")]
extern "system" {
    fn CreateFileW(
        name: *const u16,
        access: u32,
        share: u32,
        security: *const u8,
        disposition: u32,
        flags: u32,
        template: Handle,
    ) -> Handle;
    fn GetFileInformationByHandle(handle: Handle, info: *mut FileInfo) -> i32;
    fn SetFileInformationByHandle(handle: Handle, class: u32, info: *const u8, size: u32) -> i32;
    fn CloseHandle(handle: Handle) -> i32;
}
#[cfg(not(test))]
#[link(name = "shell32")]
extern "system" {
    fn SHGetKnownFolderPath(
        folder: *const Guid,
        flags: u32,
        token: Handle,
        value: *mut *mut u16,
    ) -> i32;
}
#[cfg(not(test))]
#[link(name = "ole32")]
extern "system" {
    fn CoInitializeEx(reserved: *const u8, coinit: u32) -> i32;
    fn CoUninitialize();
    fn CoTaskMemFree(memory: *const u8);
}

struct OpenHandle(Handle);
impl Drop for OpenHandle {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}

fn wide(path: &OsStr) -> Vec<u16> {
    path.encode_wide().chain(std::iter::once(0)).collect()
}

fn open(path: &Path, access: u32, directory: bool) -> io::Result<OpenHandle> {
    let name = wide(path.as_os_str());
    // Directories stay writable by the rest of Windows, but cannot be renamed
    // while held. Candidate files require exclusive access: an open reader also
    // means the file is in use and must not be deleted by this cleanup.
    let share = if directory {
        FILE_SHARE_READ | FILE_SHARE_WRITE
    } else {
        0
    };
    let flags = FILE_FLAG_OPEN_REPARSE_POINT
        | if directory {
            FILE_FLAG_BACKUP_SEMANTICS
        } else {
            0
        };
    let raw = unsafe {
        CreateFileW(
            name.as_ptr(),
            access,
            share,
            std::ptr::null(),
            OPEN_EXISTING,
            flags,
            0,
        )
    };
    if raw == INVALID_HANDLE {
        Err(io::Error::last_os_error())
    } else {
        Ok(OpenHandle(raw))
    }
}

fn info(handle: &OpenHandle) -> io::Result<FileInfo> {
    let mut value = std::mem::MaybeUninit::<FileInfo>::uninit();
    let ok = unsafe { GetFileInformationByHandle(handle.0, value.as_mut_ptr()) };
    if ok == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(unsafe { value.assume_init() })
    }
}

fn size(value: &FileInfo) -> u64 {
    ((value.size_high as u64) << 32) | value.size_low as u64
}
fn timestamp(value: FileTime) -> u64 {
    ((value.high as u64) << 32) | value.low as u64
}
// Extração (zip, 7-Zip, NSIS, MSI) preserva o mtime antigo; a criação revela
// o arquivo recém-extraído. Elegível só quando as duas datas passam do limite.
fn old_enough(value: &FileInfo, cutoff: u64) -> bool {
    timestamp(value.created).max(timestamp(value.modified)) <= cutoff
}
fn id(value: &FileInfo) -> (u32, u64) {
    (
        value.volume,
        ((value.file_index_high as u64) << 32) | value.file_index_low as u64,
    )
}
fn cutoff_filetime() -> Result<u64, String> {
    let cutoff = SystemTime::now()
        .checked_sub(MIN_AGE)
        .ok_or("relógio inválido")?;
    let unix = cutoff
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "relógio inválido")?;
    Ok(116_444_736_000_000_000u64 + (unix.as_nanos() / 100) as u64)
}
#[cfg(test)]
fn local_app_data() -> Result<PathBuf, String> {
    Ok(PathBuf::from(
        env::var_os("LOCALAPPDATA").ok_or("LOCALAPPDATA indisponível")?,
    ))
}

#[cfg(not(test))]
fn local_app_data() -> Result<PathBuf, String> {
    // An environment variable is caller-controlled. The Known Folder API
    // resolves the logged-in user's registered Local AppData location.
    let initialized = unsafe { CoInitializeEx(std::ptr::null(), 2) };
    if initialized < 0 {
        return Err("COM indisponível para localizar Temp".into());
    }
    let mut raw: *mut u16 = std::ptr::null_mut();
    let status = unsafe { SHGetKnownFolderPath(&LOCAL_APP_DATA, 0, 0, &mut raw) };
    let result = if status < 0 || raw.is_null() {
        Err("Local AppData indisponível".into())
    } else {
        let mut len = 0usize;
        while len < 32768 && unsafe { *raw.add(len) } != 0 {
            len += 1;
        }
        if len == 32768 {
            Err("Caminho Local AppData inválido".into())
        } else {
            let slice = unsafe { std::slice::from_raw_parts(raw, len) };
            Ok(PathBuf::from(OsString::from_wide(slice)))
        }
    };
    if !raw.is_null() {
        unsafe { CoTaskMemFree(raw as *const u8) };
    }
    unsafe { CoUninitialize() };
    result
}

fn safe_root() -> Result<PathBuf, String> {
    let local = local_app_data()?;
    let local = local.canonicalize().map_err(|e| e.to_string())?;
    let expected = local.join("Temp");
    let handle = open(&expected, FILE_READ_ATTRIBUTES, true).map_err(|e| e.to_string())?;
    let details = info(&handle).map_err(|e| e.to_string())?;
    if details.attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
        || details.attributes & FILE_ATTRIBUTE_DIRECTORY == 0
    {
        return Err("Temp do usuário é um redirecionamento ou não é uma pasta".into());
    }
    let root = expected.canonicalize().map_err(|e| e.to_string())?;
    if root.parent() != Some(local.as_path()) {
        return Err("Temp fora da raiz autorizada".into());
    }
    Ok(root)
}

#[derive(Clone)]
struct Candidate {
    relative: PathBuf,
    identity: (u32, u64),
    size: u64,
    modified: u64,
}
struct Scan {
    root: PathBuf,
    files: Vec<Candidate>,
    scanned: usize,
    ignored: usize,
    limited: bool,
    digest: String,
    bytes: u64,
}

fn directory_chain(root: &Path, relative_dir: &Path) -> io::Result<Vec<OpenHandle>> {
    let mut chain = Vec::new();
    let mut current = root.to_path_buf();
    let root_handle = open(&current, FILE_READ_ATTRIBUTES, true)?;
    let root_info = info(&root_handle)?;
    if root_info.attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
        || root_info.attributes & FILE_ATTRIBUTE_DIRECTORY == 0
    {
        return Err(io::Error::other("raiz alterada"));
    }
    chain.push(root_handle);
    for component in relative_dir.components() {
        use std::path::Component;
        let Component::Normal(name) = component else {
            return Err(io::Error::other("caminho inválido"));
        };
        current.push(name);
        let handle = open(&current, FILE_READ_ATTRIBUTES, true)?;
        let details = info(&handle)?;
        if details.attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
            || details.attributes & FILE_ATTRIBUTE_DIRECTORY == 0
        {
            return Err(io::Error::other("pasta redirecionada"));
        }
        chain.push(handle);
    }
    Ok(chain)
}

fn candidate(root: &Path, relative: &Path, cutoff: u64) -> Option<Candidate> {
    let parent = relative.parent()?;
    let _chain = directory_chain(root, parent).ok()?;
    let file = open(&root.join(relative), FILE_READ_ATTRIBUTES | DELETE, false).ok()?;
    let details = info(&file).ok()?;
    if details.attributes & (FILE_ATTRIBUTE_REPARSE_POINT | FILE_ATTRIBUTE_DIRECTORY) != 0
        || details.links != 1
        || !old_enough(&details, cutoff)
    {
        return None;
    }
    Some(Candidate {
        relative: relative.to_path_buf(),
        identity: id(&details),
        size: size(&details),
        modified: timestamp(details.modified),
    })
}

fn digest(files: &[Candidate]) -> String {
    let mut hash = Sha256::new();
    for entry in files {
        for code in entry.relative.as_os_str().encode_wide() {
            hash.update(code.to_le_bytes());
        }
        hash.update(0u16.to_le_bytes());
        hash.update(entry.identity.0.to_le_bytes());
        hash.update(entry.identity.1.to_le_bytes());
        hash.update(entry.size.to_le_bytes());
        hash.update(entry.modified.to_le_bytes());
    }
    hash.finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn scan() -> Result<Scan, String> {
    let root = safe_root()?;
    let cutoff = cutoff_filetime()?;
    let started = Instant::now();
    let mut files = Vec::new();
    let mut stack = vec![PathBuf::new()];
    let mut scanned = 0;
    let mut ignored = 0;
    let mut limited = false;
    while let Some(dir) = stack.pop() {
        if scanned >= MAX_ITEMS || started.elapsed() >= MAX_TIME {
            limited = true;
            break;
        }
        let _chain = match directory_chain(&root, &dir) {
            Ok(value) => value,
            Err(_) => {
                ignored += 1;
                continue;
            }
        };
        let read = match fs::read_dir(root.join(&dir)) {
            Ok(value) => value,
            Err(_) => {
                ignored += 1;
                continue;
            }
        };
        let mut entries = Vec::new();
        for entry in read {
            if scanned + entries.len() >= MAX_ITEMS || started.elapsed() >= MAX_TIME {
                limited = true;
                break;
            }
            match entry {
                Ok(value) => entries.push(value),
                Err(_) => ignored += 1,
            }
        }
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            if scanned >= MAX_ITEMS || started.elapsed() >= MAX_TIME {
                limited = true;
                break;
            }
            scanned += 1;
            if scanned % 1000 == 0 {
                eprintln!("ADR_PROGRESS:{scanned}:0");
            }
            let relative = dir.join(entry.file_name());
            let details = match fs::symlink_metadata(entry.path()) {
                Ok(value) => value,
                Err(_) => {
                    ignored += 1;
                    continue;
                }
            };
            use std::os::windows::fs::MetadataExt;
            if details.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
                ignored += 1;
                continue;
            }
            if details.is_dir() {
                stack.push(relative);
                continue;
            }
            if !details.is_file() {
                ignored += 1;
                continue;
            }
            if let Some(value) = candidate(&root, &relative, cutoff) {
                files.push(value);
            } else {
                ignored += 1;
            }
        }
        if limited {
            break;
        }
    }
    files.sort_by(|a, b| a.relative.cmp(&b.relative));
    let bytes = files
        .iter()
        .fold(0u64, |total, entry| total.saturating_add(entry.size));
    let digest = digest(&files);
    Ok(Scan {
        root,
        files,
        scanned,
        ignored,
        limited,
        digest,
        bytes,
    })
}

pub fn preview() -> Result<Value, String> {
    let result = scan()?;
    Ok(
        json!({"id":result.digest,"files":result.files.len(),"bytes":result.bytes,
        "scanned":result.scanned,"ignored":result.ignored,"limited":result.limited}),
    )
}

pub fn apply(expected_id: &str, confirmed: bool) -> Result<Value, String> {
    if !confirmed {
        return Err("Exclusão definitiva não confirmada".into());
    }
    if expected_id.len() != 64 || !expected_id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("Prévia de limpeza inválida".into());
    }
    let result = scan()?;
    if result.limited {
        return Err("Análise limitada; não é seguro aplicar a limpeza".into());
    }
    if result.digest != expected_id {
        return Err("Arquivos temporários mudaram; analise novamente".into());
    }
    let cutoff = cutoff_filetime()?;
    let mut deleted = 0usize;
    let mut bytes = 0u64;
    let mut skipped = 0usize;
    let mut pending = 0usize;
    for entry in &result.files {
        let parent = entry.relative.parent().ok_or("caminho inválido")?;
        let _chain = match directory_chain(&result.root, parent) {
            Ok(value) => value,
            Err(_) => {
                skipped += 1;
                continue;
            }
        };
        let file = match open(
            &result.root.join(&entry.relative),
            FILE_READ_ATTRIBUTES | DELETE,
            false,
        ) {
            Ok(value) => value,
            Err(_) => {
                skipped += 1;
                continue;
            }
        };
        let details = match info(&file) {
            Ok(value) => value,
            Err(_) => {
                skipped += 1;
                continue;
            }
        };
        if details.attributes & (FILE_ATTRIBUTE_REPARSE_POINT | FILE_ATTRIBUTE_DIRECTORY) != 0
            || details.links != 1
            || id(&details) != entry.identity
            || size(&details) != entry.size
            || timestamp(details.modified) != entry.modified
            || !old_enough(&details, cutoff)
        {
            skipped += 1;
            continue;
        }
        let disposition = Disposition { delete_file: 1 };
        let ok = unsafe {
            SetFileInformationByHandle(
                file.0,
                FILE_DISPOSITION_INFO_CLASS,
                &disposition as *const _ as *const u8,
                std::mem::size_of::<Disposition>() as u32,
            )
        };
        if ok == 0 {
            skipped += 1;
            continue;
        }
        drop(file);
        if !matches!(fs::symlink_metadata(result.root.join(&entry.relative)), Err(ref error) if error.kind() == io::ErrorKind::NotFound)
        {
            pending += 1;
            continue;
        }
        deleted += 1;
        bytes = bytes.saturating_add(entry.size);
        if deleted % 100 == 0 {
            eprintln!("ADR_PROGRESS:{deleted}:{bytes}");
        }
    }
    Ok(
        json!({"deleted":deleted,"bytes":bytes,"skipped":skipped,"pending":pending,
        "scanned":result.scanned,"limited":false,"partial":skipped>0 || pending>0}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{FileTimes, OpenOptions};
    use std::os::windows::fs::{FileTimesExt, OpenOptionsExt};

    fn age(path: &Path, times: FileTimes) {
        let file = OpenOptions::new().write(true).open(path).unwrap();
        file.set_times(times).unwrap();
    }

    #[test]
    fn recent_creation_blocks_old_mtime() {
        let at = |value: u64| FileTime {
            low: value as u32,
            high: (value >> 32) as u32,
        };
        let cutoff = 1u64 << 40;
        let mut details = FileInfo {
            attributes: 0,
            created: at(cutoff - 1),
            accessed: at(cutoff - 1),
            modified: at(cutoff - 1),
            volume: 0,
            size_high: 0,
            size_low: 0,
            links: 1,
            file_index_high: 0,
            file_index_low: 0,
        };
        assert!(old_enough(&details, cutoff));
        details.created = at(cutoff + 1);
        assert!(!old_enough(&details, cutoff));
        details.created = at(cutoff - 1);
        details.modified = at(cutoff + 1);
        assert!(!old_enough(&details, cutoff));
    }

    #[test]
    fn only_old_single_link_files_in_isolated_temp_are_removed() {
        let fixture = tempfile::tempdir().unwrap();
        let local = fixture.path().join("Local");
        let temp = local.join("Temp");
        fs::create_dir_all(&temp).unwrap();
        // This process alone runs this test; never point LOCALAPPDATA at the
        // runner's actual profile or the user's real temporary directory.
        let previous = env::var_os("LOCALAPPDATA");
        env::set_var("LOCALAPPDATA", &local);
        let old = temp.join("ação antiga.txt");
        let recent = temp.join("recente.txt");
        let linked = temp.join("com link.txt");
        let held_path = temp.join("em uso.txt");
        let extracted = temp.join("extraído agora.txt");
        fs::write(&old, b"old").unwrap();
        fs::write(&recent, b"new").unwrap();
        fs::write(&linked, b"shared").unwrap();
        fs::write(&held_path, b"busy").unwrap();
        fs::write(&extracted, b"payload").unwrap();
        fs::hard_link(&linked, fixture.path().join("outside-hardlink.txt")).unwrap();
        let old_time = SystemTime::now() - MIN_AGE - Duration::from_secs(86_400);
        let old_times = FileTimes::new()
            .set_modified(old_time)
            .set_created(old_time);
        age(&old, old_times);
        age(&linked, old_times);
        age(&held_path, old_times);
        // Extração recente: mtime antigo preservado, criação de agora.
        age(&extracted, FileTimes::new().set_modified(old_time));
        let held = OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ)
            .open(&held_path)
            .unwrap();
        let outside = fixture.path().join("outside-directory");
        fs::create_dir(&outside).unwrap();
        let outside_file = outside.join("outside.txt");
        fs::write(&outside_file, b"outside").unwrap();
        let junction_like = temp.join("link de pasta");
        let linked_dir = std::os::windows::fs::symlink_dir(&outside, &junction_like).is_ok();

        let before = preview().unwrap();
        assert_eq!(before["files"], 1);
        assert_eq!(before["bytes"], 3);
        let digest = before["id"].as_str().unwrap();
        assert!(apply(digest, false).is_err());
        assert!(old.exists());
        assert!(apply(&"0".repeat(64), true).is_err());
        assert!(old.exists());
        let changed = temp.join("adicionado depois da prévia.txt");
        fs::write(&changed, b"changed").unwrap();
        age(&changed, old_times);
        assert!(apply(digest, true).is_err());
        assert!(old.exists());
        fs::remove_file(&changed).unwrap();
        let outcome = apply(digest, true).unwrap();
        assert_eq!(outcome["deleted"], 1);
        assert!(!old.exists());
        assert!(recent.exists());
        assert!(extracted.exists());
        assert!(linked.exists());
        assert!(held_path.exists());
        drop(held);
        if linked_dir {
            assert!(junction_like.exists());
        }
        assert!(outside_file.exists());
        assert!(fixture.path().join("outside-hardlink.txt").exists());
        if let Some(value) = previous {
            env::set_var("LOCALAPPDATA", value);
        } else {
            env::remove_var("LOCALAPPDATA");
        }
    }
}
