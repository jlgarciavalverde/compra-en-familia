#!/usr/bin/env bash
# Trae a este Mac la última copia consistente de la base de datos de Compra en Familia (respaldo fuera del servidor).
#
# El VPS ya guarda copias de la app en el mismo disco; esto añade una copia en OTRO equipo, que es lo que protege
# de un fallo de disco. Comprueba que la copia se abre y no está corrupta antes de conservarla.
#
#   ./scripts/pull-backups.sh                # una copia ahora
#   VPS=usuario@host KEEP=30 ./scripts/pull-backups.sh
#
# Para que se haga sola cada día, ver docs/OPERACIONES.md (launchd).
set -euo pipefail

VPS="${VPS:-joseluis@192.168.18.7}"
DEST="${DEST:-$HOME/Backups/compra-en-familia}"
KEEP="${KEEP:-14}"
REMOTE_DIR="servicios/compra/data/backups"

mkdir -p "$DEST"
stamp="$(date +%F_%H%M)"

# La app vuelca una copia consistente (VACUUM INTO) cada 6 h; se coge la más reciente.
latest="$(ssh -o BatchMode=yes -o ConnectTimeout=10 "$VPS" "ls -1t $REMOTE_DIR/compra-*.db 2>/dev/null | head -1")"
if [ -z "$latest" ]; then
  echo "No hay copias en $VPS:$REMOTE_DIR" >&2
  exit 1
fi

tmp="$DEST/.descarga-$stamp.db"
trap 'rm -f "$tmp"' EXIT
scp -q -o BatchMode=yes "$VPS:$latest" "$tmp"

# Integridad: si la copia está rota, no se guarda.
check="$(sqlite3 "$tmp" 'PRAGMA integrity_check;' 2>&1 | head -1)"
if [ "$check" != "ok" ]; then
  echo "La copia descargada no pasa la comprobación de integridad: $check" >&2
  exit 1
fi
users="$(sqlite3 "$tmp" 'SELECT COUNT(*) FROM users;')"
lists="$(sqlite3 "$tmp" 'SELECT COUNT(*) FROM lists WHERE deleted_at IS NULL;')"

mv "$tmp" "$DEST/compra-$stamp.db"
trap - EXIT
echo "✓ $DEST/compra-$stamp.db  (origen: $(basename "$latest"), $users usuarios, $lists listas)"

# Retención: se conservan las KEEP más recientes.
ls -1t "$DEST"/compra-*.db | tail -n +"$((KEEP + 1))" | while read -r old; do rm -f "$old"; done
echo "Copias guardadas: $(ls -1 "$DEST"/compra-*.db | wc -l | tr -d ' ') (máximo $KEEP)"
