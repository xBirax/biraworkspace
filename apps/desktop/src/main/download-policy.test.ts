import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  isRiskyExecutable,
  opensByDefault,
  releaseReservedDownloadPath,
  reserveUniqueDownloadPath,
  sanitizeDownloadFilename,
  uniqueDownloadPath,
} from "./download-policy.js";

describe("uniqueDownloadPath", () => {
  it("keeps original when free", () => {
    expect(uniqueDownloadPath("/tmp", "a.pdf", () => false)).toBe(path.join("/tmp", "a.pdf"));
  });

  it("adds (n) on conflict", () => {
    const taken = new Set([path.join("/tmp", "a.pdf"), path.join("/tmp", "a (1).pdf")]);
    expect(uniqueDownloadPath("/tmp", "a.pdf", (p) => taken.has(p))).toBe(
      path.join("/tmp", "a (2).pdf"),
    );
  });

  it("strips path traversal from filename", () => {
    expect(uniqueDownloadPath("/tmp", "../../etc/passwd", () => false)).toBe(
      path.join("/tmp", "passwd"),
    );
  });
});

describe("reserved download paths", () => {
  it("allocates different paths for concurrent downloads before files exist", () => {
    const reserved = new Set<string>();
    const exists = () => false;
    const first = reserveUniqueDownloadPath("/tmp", "report.pdf", exists, reserved);
    const second = reserveUniqueDownloadPath("/tmp", "report.pdf", exists, reserved);
    expect(first).toBe(path.join("/tmp", "report.pdf"));
    expect(second).toBe(path.join("/tmp", "report (1).pdf"));
  });

  it("uses case-insensitive reservation keys on Windows and releases them consistently", () => {
    const reserved = new Set<string>();
    const first = reserveUniqueDownloadPath("C:\\Users\\me\\Downloads", "Report.pdf", () => false, reserved, "win32");
    const second = reserveUniqueDownloadPath("c:\\users\\ME\\downloads", "report.PDF", () => false, reserved, "win32");
    expect(first).toBe(path.join("C:\\Users\\me\\Downloads", "Report.pdf"));
    expect(second).not.toBe(first);
    releaseReservedDownloadPath(first, reserved, "win32");
    const afterRelease = reserveUniqueDownloadPath("c:\\users\\ME\\downloads", "REPORT.PDF", () => false, reserved, "win32");
    expect(afterRelease.toLowerCase()).toContain("report.pdf");
  });
});

describe("sanitizeDownloadFilename", () => {
  it("escapes Windows reserved device names, with or without extension", () => {
    expect(sanitizeDownloadFilename("NUL.pdf")).toBe("_NUL.pdf");
    expect(sanitizeDownloadFilename("com1")).toBe("_com1");
  });

  it("drops trailing dot/space that Windows would silently remove", () => {
    expect(sanitizeDownloadFilename("relatorio .pdf ")).toBe("relatorio .pdf");
    expect(sanitizeDownloadFilename("nota.")).toBe("nota");
  });

  it("keeps spaces and accents inside the name", () => {
    expect(sanitizeDownloadFilename("relatório final.pdf")).toBe("relatório final.pdf");
  });

  it("never returns empty", () => {
    expect(sanitizeDownloadFilename("...")).toBe("download");
  });
});

describe("isRiskyExecutable", () => {
  it("flags what Windows runs on open", () => {
    for (const name of ["setup.exe", "a.BAT", "x.ps1", "y.lnk", "z.msi", "fatura.iso", "site.url", "ajuda.chm"]) {
      expect(isRiskyExecutable(name)).toBe(true);
    }
  });

  it("leaves documents and media alone", () => {
    for (const name of ["nota.pdf", "foto.jpg", "planilha.xlsx", "sem-extensao"]) {
      expect(isRiskyExecutable(name)).toBe(false);
    }
  });
});

describe("tipos que abrem sem perguntar", () => {
  it.each(["reuniao.rdp", "x.library-ms", "busca.search-ms", "planilha.xlsm", "doc.docm", "a.wsb"])(
    "trata %s como arriscado",
    (name) => {
      expect(isRiskyExecutable(name)).toBe(true);
    },
  );

  it("só tipos inofensivos ganham Abrir como padrão", () => {
    expect(opensByDefault("contrato.PDF")).toBe(true);
    expect(opensByDefault("foto.jpg")).toBe(true);
    expect(opensByDefault("arquivo.xyz")).toBe(false);
    expect(opensByDefault("sem-extensao")).toBe(false);
  });
});
