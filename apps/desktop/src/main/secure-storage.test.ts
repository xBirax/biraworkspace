import {describe,it,expect} from "vitest";
import {secureStorageAvailable} from "./secure-storage.js";
describe("chaveiro Linux",()=>{
  for(const [backend,secure] of [["basic_text",false],["unknown",false],["gnome_libsecret",true],["kwallet6",true]] as const)
    it(backend,()=>expect(secureStorageAvailable({isEncryptionAvailable:()=>true,getSelectedStorageBackend:()=>backend},"linux")).toBe(secure));
  it("chaveiro indisponível",()=>expect(secureStorageAvailable({isEncryptionAvailable:()=>false,getSelectedStorageBackend:()=>"gnome_libsecret"},"linux")).toBe(false));
});
