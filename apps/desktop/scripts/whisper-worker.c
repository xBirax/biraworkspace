// Windows build used with whisper.cpp b5454 (CUDA 11.8):
// zig cc -target x86_64-windows-gnu -O2 -I<whisper-and-ggml-headers> whisper-worker.c -o bira-whisper-worker.exe
// Install alongside whisper.dll and ggml.dll in BiraWorkspace/whisper-cuda/Release.
#include <windows.h>
#include <stdio.h>
#include <stdint.h>
#include <stdlib.h>
#include <fcntl.h>
#include <io.h>
#include "whisper.h"

#define LOAD(lib, name) __typeof__(&name) fn_##name = (__typeof__(&name))GetProcAddress(lib, #name); if (!fn_##name) return 2

int main(int argc, char **argv) {
    if (argc != 2) return 2;
    _setmode(_fileno(stdin), _O_BINARY);
    _setmode(_fileno(stdout), _O_BINARY);
    HMODULE ggml = LoadLibraryW(L"ggml.dll");
    HMODULE whisper = LoadLibraryW(L"whisper.dll");
    if (!ggml || !whisper) return 2;
    LOAD(ggml, ggml_backend_load_all);
    LOAD(whisper, whisper_context_default_params);
    LOAD(whisper, whisper_init_from_file_with_params);
    LOAD(whisper, whisper_full_default_params);
    LOAD(whisper, whisper_full);
    LOAD(whisper, whisper_full_n_segments);
    LOAD(whisper, whisper_full_get_segment_text);
    LOAD(whisper, whisper_free);
    fn_ggml_backend_load_all();
    struct whisper_context *ctx = fn_whisper_init_from_file_with_params(argv[1], fn_whisper_context_default_params());
    if (!ctx) return 3;
    struct whisper_full_params options = fn_whisper_full_default_params(WHISPER_SAMPLING_BEAM_SEARCH);
    options.language = "pt";
    options.n_threads = 4;
    options.no_context = true;
    options.print_progress = false;
    options.print_realtime = false;
    options.print_timestamps = false;
    uint32_t bytes;
    while (fread(&bytes, sizeof(bytes), 1, stdin) == 1) {
        static const char *languages[] = {"pt","en","es","auto"};
        unsigned int language = bytes >> 28;
        if (language >= 4) return 4;
        options.language = languages[language];
        bytes &= 0x0fffffff;
        if (!bytes || bytes % 2 || bytes > 19200000) return 4;
        size_t count = bytes / 2;
        int16_t *pcm = malloc(bytes);
        float *samples = malloc(count * sizeof(*samples));
        if (!pcm || !samples || fread(pcm, 1, bytes, stdin) != bytes) return 4;
        for (size_t i = 0; i < count; i++) samples[i] = pcm[i] / 32768.0f;
        free(pcm);
        if (fn_whisper_full(ctx, options, samples, (int)count) == 0) {
            int segments = fn_whisper_full_n_segments(ctx);
            for (int i = 0; i < segments; i++) {
                const char *s = fn_whisper_full_get_segment_text(ctx, i);
                for (; s && *s; s++) fputc(*s == '\n' || *s == '\r' ? ' ' : (unsigned char)*s, stdout);
            }
        }
        free(samples);
        fputc('\n', stdout);
        fflush(stdout);
    }
    fn_whisper_free(ctx);
    return 0;
}
