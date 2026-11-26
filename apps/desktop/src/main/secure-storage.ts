import type {SafeStorage} from "electron";

export function secureStorageAvailable(storage:Pick<SafeStorage,"isEncryptionAvailable"> & Partial<Pick<SafeStorage,"getSelectedStorageBackend">>, platform=process.platform) {
  if (!storage.isEncryptionAvailable()) return false;
  if (platform!=="linux") return true;
  const backend=storage.getSelectedStorageBackend?.();
  return !!backend && backend!=="basic_text" && backend!=="unknown";
}
