#!/bin/sh
# Ubuntu 24.04 x64. Install and validate the local CPU recognizer for this user.
set -eu
umask 077
root=${XDG_DATA_HOME:-"$HOME/.local/share"}/BiraWorkspace
mkdir -p "$root/models" "$root/whisper"
exec 9>"$root/.voice-install.lock"
flock 9
stage=$(mktemp -d "$root/.voice-XXXXXXXX")
trap 'rm -rf -- "$stage"' EXIT
model="$root/models/ggml-small.bin"
digest=1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b
verify() { printf '%s  %s\n' "$1" "$2" | sha256sum --check --status; }
if ! test -f "$model" || ! verify "$digest" "$model"; then
    curl --retry 3 -fL https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin -o "$stage/model"
    verify "$digest" "$stage/model"
    mv "$stage/model" "$model"
fi
version=v1.8.2
if test -f "$root/whisper/$version.sha256" && (cd "$root/whisper" && sha256sum --check --status "$version.sha256"); then
    exit 0
fi
curl --retry 3 -fL "https://codeload.github.com/ggml-org/whisper.cpp/tar.gz/refs/tags/$version" -o "$stage/source.tgz"
verify bcee25589bb8052d9e155369f6759a05729a2022d2a8085c1aa4345108523077 "$stage/source.tgz"
mkdir "$stage/src"
tar -xzf "$stage/source.tgz" -C "$stage/src" --strip-components=1
cmake -S "$stage/src" -B "$stage/build" -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_TESTS=OFF -DGGML_NATIVE=OFF
cmake --build "$stage/build" --target whisper-cli -j2
"$stage/build/bin/whisper-cli" --help >/dev/null 2>&1
mv "$stage/build/bin/whisper-cli" "$root/whisper/whisper-cli"
(cd "$root/whisper" && sha256sum whisper-cli > "$stage/cli.sha256")
mv "$stage/cli.sha256" "$root/whisper/$version.sha256"

