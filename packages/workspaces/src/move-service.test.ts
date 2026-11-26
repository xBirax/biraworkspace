import { describe, expect, it } from "vitest";
import { createEmptyAppState, parseAppState } from "@adr/app-state";
import { createWorkspace, moveServiceToWorkspace } from "./index.js";

function fixture() {
  let state = createWorkspace(createEmptyAppState(), { name:"Importado ADR", color:"#123456", crmProfileId:"crm-a" });
  state = createWorkspace(state, { name:"Pessoal", color:"#abcdef", crmProfileId:"crm-b" });
  const [source,target] = state.workspaces;
  state.profiles.push({ id:"profile-imported", kind:"whatsapp", name:"Conta", partitionName:"persist:wa-profile-imported", createdAt:new Date().toISOString() });
  state.services.push({ id:"imported-wa", workspaceId:source!.id, kind:"whatsapp", name:"Importado", startUrl:"https://web.whatsapp.com", profileId:"profile-imported", pinned:true, keepAwake:true });
  source!.serviceInstanceIds.push("imported-wa"); source!.crmPosition=1;
  state.activeServiceId="imported-wa";
  state.settings.whatsappLockServiceIds["imported-wa"]=true;
  state.settings.whatsappPrivacyModes={"imported-wa":"discreet"};
  return {state:parseAppState(state),source:source!.id,target:target!.id};
}

describe("moving imported services between workspaces",()=>{
  it("preserves profile, PIN, privacy and identity across save/reload and return",()=>{
    const {state,source,target}=fixture();const before=JSON.stringify(state);
    const moved=moveServiceToWorkspace(state,"imported-wa",target);
    expect(moved.profiles).toEqual(state.profiles);
    expect(moved.settings).toEqual(state.settings);
    expect(moved.services[0]).toEqual({...state.services[0],workspaceId:target});
    expect(moved.workspaces[0]!.serviceInstanceIds).toEqual([]);
    expect(moved.workspaces[0]!.crmPosition).toBe(0);
    expect(moved.workspaces[1]!.serviceInstanceIds).toEqual(["imported-wa"]);
    expect(moved.activeWorkspaceId).toBe(target);
    expect(JSON.stringify(state)).toBe(before);
    const returned=moveServiceToWorkspace(parseAppState(JSON.parse(JSON.stringify(moved))),"imported-wa",source);
    expect(returned.services).toEqual(state.services);
    expect(returned.profiles).toEqual(state.profiles);
    expect(returned.workspaces[1]!.serviceInstanceIds).toEqual([]);
  });
  it("rejects missing/deleted destinations without changing state",()=>{
    const {state,target}=fixture();
    expect(()=>moveServiceToWorkspace(state,"missing",target)).toThrow("serviço inexistente");
    expect(()=>moveServiceToWorkspace(state,"imported-wa","missing")).toThrow("workspace inexistente");
    state.workspaces[1]!.deletedAt=new Date().toISOString();
    expect(()=>moveServiceToWorkspace(state,"imported-wa",target)).toThrow("workspace inexistente");
  });
  it("does not duplicate a service when dropped into its current workspace",()=>{
    const {state,source}=fixture();expect(moveServiceToWorkspace(state,"imported-wa",source)).toBe(state);
  });
});
