#![cfg(windows)]

mod cleanup;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{self, Read, Write};
use std::path::PathBuf;
use std::process::Command;
use winreg::enums::{HKEY_CURRENT_USER, KEY_READ};
use winreg::{RegKey, RegValue};

const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const APPROVED: &str = r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "kebab-case", deny_unknown_fields)]
enum Request {
    Snapshot,
    DisableStartup {
        name: String,
        expected_run: String,
        expected_approved: Option<String>,
    },
    RestoreStartup {
        name: String,
        expected_run: String,
        expected_disabled: String,
        previous_approved: Option<String>,
    },
    SetPower {
        expected: String,
        target: String,
    },
    PreviewCleanup,
    ApplyCleanup {
        expected_id: String,
        confirmed: bool,
    },
}

#[derive(Serialize)]
struct Response {
    ok: bool,
    data: Value,
    error: Option<String>,
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
fn unhex(s: &str) -> Result<Vec<u8>, String> {
    if s.len() % 2 != 0 || !s.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("hex inválido".into());
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).map_err(|_| "hex inválido".into()))
        .collect()
}
fn encoded(v: &RegValue) -> String {
    format!("{}:{}", v.vtype.clone() as u32, hex(&v.bytes))
}
fn decoded(s: &str) -> Result<RegValue, String> {
    let (kind, bytes) = s.split_once(':').ok_or("registro inválido")?;
    let kind = kind.parse::<u32>().map_err(|_| "tipo inválido")?;
    if kind != 3 {
        return Err("tipo de StartupApproved inválido".into());
    }
    let bytes = unhex(bytes)?;
    Ok(RegValue {
        vtype: winreg::enums::REG_BINARY,
        bytes: bytes.into(),
    })
}
fn key(path: &str, write: bool) -> Result<RegKey, String> {
    let root = RegKey::predef(HKEY_CURRENT_USER);
    if write {
        root.create_subkey(path)
            .map(|(key, _)| key)
            .map_err(|e| e.to_string())
    } else {
        root.open_subkey_with_flags(path, KEY_READ)
            .map_err(|e| e.to_string())
    }
}
fn raw_optional(key: &RegKey, name: &str) -> Result<Option<RegValue>, String> {
    match key.get_raw_value(name) {
        Ok(v) => Ok(Some(v)),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}
fn checked_name(name: &str) -> Result<(), String> {
    if name.is_empty()
        || name.len() > 256
        || name.chars().any(|c| c == '\\' || c == '/' || c == '\0')
    {
        Err("nome inválido".into())
    } else {
        Ok(())
    }
}
fn guid(s: &str) -> bool {
    s.len() == 36
        && s.bytes().enumerate().all(|(i, b)| {
            if [8, 13, 18, 23].contains(&i) {
                b == b'-'
            } else {
                b.is_ascii_hexdigit()
            }
        })
}
fn guids(text: &str) -> Vec<String> {
    let mut result = Vec::new();
    for word in text.split(|c: char| !c.is_ascii_hexdigit() && c != '-') {
        if guid(word) {
            let id = word.to_ascii_lowercase();
            if !result.contains(&id) {
                result.push(id);
            }
        }
    }
    result
}
#[link(name = "kernel32")]
extern "system" {
    fn GetSystemDirectoryW(buffer: *mut u16, size: u32) -> u32;
    fn GetSystemPowerStatus(status: *mut SystemPowerStatus) -> i32;
}
#[repr(C)]
struct SystemPowerStatus {
    ac_line_status: u8,
    battery_flag: u8,
    battery_life_percent: u8,
    system_status_flag: u8,
    battery_life_time: u32,
    battery_full_life_time: u32,
}
fn battery_status() -> Value {
    let mut status = SystemPowerStatus {
        ac_line_status: 255,
        battery_flag: 255,
        battery_life_percent: 255,
        system_status_flag: 0,
        battery_life_time: u32::MAX,
        battery_full_life_time: u32::MAX,
    };
    if unsafe { GetSystemPowerStatus(&mut status) } == 0 {
        return json!({"onBattery":null,"percent":null});
    }
    let on_battery = match status.ac_line_status {
        0 => Some(true),
        1 => Some(false),
        _ => None,
    };
    let percent = if status.battery_life_percent <= 100 {
        Some(status.battery_life_percent)
    } else {
        None
    };
    json!({"onBattery":on_battery,"percent":percent})
}
fn system_powercfg() -> Result<PathBuf, String> {
    let mut buffer = [0u16; 32768];
    let length = unsafe { GetSystemDirectoryW(buffer.as_mut_ptr(), buffer.len() as u32) } as usize;
    if length == 0 || length >= buffer.len() {
        return Err("System32 indisponível".into());
    }
    let directory = String::from_utf16(&buffer[..length]).map_err(|_| "System32 inválido")?;
    let path = PathBuf::from(directory).join("powercfg.exe");
    if !path.is_file() {
        return Err("powercfg indisponível".into());
    }
    Ok(path)
}
fn power(args: &[&str]) -> Result<String, String> {
    let output = Command::new(system_powercfg()?)
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(format!("powercfg retornou {}", output.status));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}
fn active_power() -> Result<String, String> {
    guids(&power(&["/getactivescheme"])?)
        .into_iter()
        .next()
        .ok_or("plano ativo indisponível".into())
}
fn startup() -> Result<Value, String> {
    let run = match RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(RUN, KEY_READ) {
        Ok(run) => run,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Ok(Value::Array(Vec::new()))
        }
        Err(error) => return Err(error.to_string()),
    };
    let approved = key(APPROVED, false).ok();
    let mut entries = Vec::new();
    for name in run
        .enum_values()
        .filter_map(Result::ok)
        .map(|(name, _)| name)
    {
        let value = run.get_raw_value(&name).map_err(|e| e.to_string())?;
        let prior = approved.as_ref().and_then(|k| k.get_raw_value(&name).ok());
        let modifiable = (value.vtype == winreg::enums::REG_SZ
            || value.vtype == winreg::enums::REG_EXPAND_SZ)
            && prior
                .as_ref()
                .is_none_or(|v| v.vtype == winreg::enums::REG_BINARY && v.bytes.len() >= 12);
        // StartupApproved byte 0 is 03 when disabled; 02 when enabled.
        let disabled = prior.as_ref().is_some_and(|v| v.bytes.first() == Some(&3));
        entries.push(json!({"name":name,"run":encoded(&value),"approved":prior.as_ref().map(encoded),"disabled":disabled,"modifiable":modifiable}));
    }
    Ok(Value::Array(entries))
}
fn snapshot() -> Result<Value, String> {
    let startup = startup()?;
    let active = active_power().ok();
    let schemes = power(&["/list"]).map(|v| guids(&v)).unwrap_or_default();
    Ok(
        json!({"startup":startup,"power":{"active":active,"schemes":schemes,"battery":battery_status()}}),
    )
}
fn disable_startup(
    name: &str,
    expected_run: &str,
    expected_approved: Option<&str>,
) -> Result<Value, String> {
    checked_name(name)?;
    let run = key(RUN, false)?;
    let run_value = run
        .get_raw_value(name)
        .map_err(|_| "entrada de inicialização mudou".to_string())?;
    if (run_value.vtype != winreg::enums::REG_SZ && run_value.vtype != winreg::enums::REG_EXPAND_SZ)
        || encoded(&run_value) != expected_run
    {
        return Err("entrada de inicialização mudou".into());
    }
    let approved = key(APPROVED, true)?;
    let current_value = raw_optional(&approved, name)?;
    let current = current_value.as_ref().map(encoded);
    if current.as_deref() != expected_approved {
        return Err("estado da inicialização mudou".into());
    }
    if let Some(value) = current_value {
        if value.vtype != winreg::enums::REG_BINARY || value.bytes.len() < 12 {
            return Err("Formato de StartupApproved inválido".into());
        }
    }
    let mut bytes = current
        .as_deref()
        .map(decoded)
        .transpose()?
        .map(|v| v.bytes)
        .unwrap_or_else(|| vec![2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    if bytes.len() < 12 {
        bytes.resize(12, 0);
    }
    bytes[0] = 3;
    let value = RegValue {
        vtype: winreg::enums::REG_BINARY,
        bytes: bytes.into(),
    };
    approved
        .set_raw_value(name, &value)
        .map_err(|e| e.to_string())?;
    Ok(json!({"disabled":encoded(&value)}))
}
fn restore_startup(
    name: &str,
    expected_run: &str,
    expected_disabled: &str,
    previous_approved: Option<&str>,
) -> Result<Value, String> {
    checked_name(name)?;
    let run = key(RUN, false)?;
    if encoded(
        &run.get_raw_value(name)
            .map_err(|_| "entrada de inicialização mudou".to_string())?,
    ) != expected_run
    {
        return Err("entrada de inicialização mudou".into());
    }
    let approved = key(APPROVED, true)?;
    if raw_optional(&approved, name)?
        .as_ref()
        .map(encoded)
        .as_deref()
        != Some(expected_disabled)
    {
        return Err("estado da inicialização mudou".into());
    }
    if let Some(prior) = previous_approved {
        approved
            .set_raw_value(name, &decoded(prior)?)
            .map_err(|e| e.to_string())?;
    } else {
        approved.delete_value(name).map_err(|e| e.to_string())?;
    }
    Ok(json!({"restored":true}))
}
fn set_power(expected: &str, target: &str) -> Result<Value, String> {
    if !guid(expected) || !guid(target) {
        return Err("GUID inválido".into());
    }
    if active_power()?.to_ascii_lowercase() != expected.to_ascii_lowercase() {
        return Err("plano de energia mudou".into());
    }
    if !guids(&power(&["/list"])?).contains(&target.to_ascii_lowercase()) {
        return Err("plano não existe".into());
    }
    power(&["/setactive", target])?;
    Ok(json!({"active":active_power()?}))
}
fn execute(request: Request) -> Result<Value, String> {
    match request {
        Request::Snapshot => snapshot(),
        Request::DisableStartup {
            name,
            expected_run,
            expected_approved,
        } => disable_startup(&name, &expected_run, expected_approved.as_deref()),
        Request::RestoreStartup {
            name,
            expected_run,
            expected_disabled,
            previous_approved,
        } => restore_startup(
            &name,
            &expected_run,
            &expected_disabled,
            previous_approved.as_deref(),
        ),
        Request::SetPower { expected, target } => set_power(&expected, &target),
        Request::PreviewCleanup => cleanup::preview(),
        Request::ApplyCleanup {
            expected_id,
            confirmed,
        } => cleanup::apply(&expected_id, confirmed),
    }
}
fn main() {
    let mut input = String::new();
    let response = match io::stdin().take(256 * 1024).read_to_string(&mut input) {
        Ok(_) => match serde_json::from_str::<Request>(&input) {
            Ok(req) => match execute(req) {
                Ok(data) => Response {
                    ok: true,
                    data,
                    error: None,
                },
                Err(error) => Response {
                    ok: false,
                    data: Value::Null,
                    error: Some(error),
                },
            },
            Err(_) => Response {
                ok: false,
                data: Value::Null,
                error: Some("comando inválido".into()),
            },
        },
        Err(_) => Response {
            ok: false,
            data: Value::Null,
            error: Some("entrada inválida".into()),
        },
    };
    let _ = io::stdout().write_all(
        serde_json::to_string(&response)
            .unwrap_or_default()
            .as_bytes(),
    );
}

#[cfg(test)]
mod tests {
    use super::{decoded, guid, guids};

    #[test]
    fn power_guid_parser_accepts_existing_guid_only() {
        let id = "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c";
        assert!(guid(id));
        assert_eq!(
            guids(&format!("Power Scheme GUID: {id} (Balanced)")),
            vec![id]
        );
        assert!(!guid("/setactive & something"));
    }

    #[test]
    fn startup_approved_accepts_binary_only() {
        assert!(decoded("3:020000000000000000000000").is_ok());
        assert!(decoded("1:0200").is_err());
        assert!(decoded("3:odd").is_err());
    }
}
