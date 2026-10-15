#!/usr/bin/env bash
set -euo pipefail
umask 077

root=${1:?Pass the dedicated deployment directory}
node_version=24.22.0
postgres_version=17.11
mkdir -p "$root"/{downloads,runtime,tmp,logs}
export TMPDIR="$root/tmp"
cd "$root/downloads"
if ! command -v bison >/dev/null || ! command -v flex >/dev/null || ! test -f "$root/runtime/build-tools/usr/include/lz4.h"; then
  apt download bison flex m4 liblz4-dev > "$root/logs/build-tools.log" 2>&1
  mkdir -p "$root/runtime/build-tools"
  for package in bison_*.deb flex_*.deb m4_*.deb liblz4-dev_*.deb; do
    dpkg-deb -x "$package" "$root/runtime/build-tools"
  done
  export PATH="$root/runtime/build-tools/usr/bin:$PATH"
  export BISON_PKGDATADIR="$root/runtime/build-tools/usr/share/bison"
  export M4="$root/runtime/build-tools/usr/bin/m4"
fi
curl --fail --location --silent --show-error --output node-shasums.txt "https://nodejs.org/dist/v$node_version/SHASUMS256.txt"
if ! grep " node-v$node_version-linux-x64.tar.xz$" node-shasums.txt | sha256sum --check --status -; then
  curl --fail --location --silent --show-error --max-time 600 --output "node-v$node_version-linux-x64.tar.xz" "https://nodejs.org/dist/v$node_version/node-v$node_version-linux-x64.tar.xz"
fi
grep " node-v$node_version-linux-x64.tar.xz$" node-shasums.txt | sha256sum --check -
tar -xJf "node-v$node_version-linux-x64.tar.xz" -C "$root/runtime"
curl --fail --location --silent --show-error --output postgres-shasums.txt "https://ftp.postgresql.org/pub/source/v$postgres_version/postgresql-$postgres_version.tar.bz2.sha256"
if ! sha256sum --check --status postgres-shasums.txt; then
  curl --fail --location --silent --show-error --max-time 600 --output "postgresql-$postgres_version.tar.bz2" "https://ftp.postgresql.org/pub/source/v$postgres_version/postgresql-$postgres_version.tar.bz2"
fi
sha256sum --check postgres-shasums.txt
tar -xjf "postgresql-$postgres_version.tar.bz2"
cd "postgresql-$postgres_version"
LZ4_CFLAGS="-I$root/runtime/build-tools/usr/include" LZ4_LIBS="-L$root/runtime/build-tools/usr/lib/x86_64-linux-gnu -llz4" ./configure --prefix="$root/runtime/postgres" --without-readline --without-icu --with-lz4 > "$root/logs/postgres-configure.log" 2>&1
make clean > "$root/logs/postgres-build.log" 2>&1
make -j4 >> "$root/logs/postgres-build.log" 2>&1
make install >> "$root/logs/postgres-build.log" 2>&1
make -C contrib/pg_trgm install >> "$root/logs/postgres-build.log" 2>&1
"$root/runtime/postgres/bin/postgres" --version
"$root/runtime/node-v$node_version-linux-x64/bin/node" --version
