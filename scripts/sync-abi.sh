#!/usr/bin/env bash
# コントラクトを変更したら実行して web 側のABIを更新する
set -euo pipefail
cd "$(dirname "$0")/.."
(cd contracts && forge build >/dev/null)
{
  echo "// contracts/ の forge 成果物から自動生成したABI。"
  echo "// 再生成: ./scripts/sync-abi.sh"
  echo "export const fuseAbi = $(cd contracts && forge inspect src/Fuse.sol:Fuse abi --json) as const;"
  echo ""
  echo "export const fuseNftAbi = $(cd contracts && forge inspect src/FuseNFT.sol:FuseNFT abi --json) as const;"
} > web/src/lib/abi.ts
echo "updated web/src/lib/abi.ts"
