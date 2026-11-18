#!/usr/bin/env bash
# MMM — Morris Multi Maths — certificate generator (macOS / Linux)
#
#   ./make-cert.sh                 use this machine's current addresses
#   ./make-cert.sh 10.0.1.42       also include an address you expect to get
#
# Creates two things in certs/:
#   ca.crt      the school authority — this is the file IT installs on devices
#   server.crt  the server's own certificate, signed by that authority
#
# Because the server certificate is signed by the CA, you can re-run this script
# whenever the laptop's IP changes without redistributing anything to students.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CERTS="$DIR/certs"
DAYS_CA=3650
DAYS_SERVER=825          # browsers reject longer-lived server certificates

command -v openssl >/dev/null 2>&1 || { echo "openssl is not installed. Install it and run again."; exit 1; }
mkdir -p "$CERTS"
cd "$CERTS"

# ---- gather the names this server will be reached by -----------------------
HOSTNAME_SHORT="$(hostname -s 2>/dev/null || hostname)"
IPS=""
if command -v ip >/dev/null 2>&1; then
  IPS="$(ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 || true)"
elif command -v ifconfig >/dev/null 2>&1; then
  IPS="$(ifconfig 2>/dev/null | awk '/inet /{print $2}' | grep -v '^127\.' || true)"
fi
EXTRA_IPS="$*"

ALT="DNS.1 = localhost
DNS.2 = ${HOSTNAME_SHORT}
DNS.3 = ${HOSTNAME_SHORT}.local
IP.1 = 127.0.0.1"
n=2
for ip in $IPS $EXTRA_IPS; do
  ALT="${ALT}
IP.${n} = ${ip}"
  n=$((n+1))
done

echo "Certificate will cover:"
echo "  localhost, ${HOSTNAME_SHORT}, ${HOSTNAME_SHORT}.local"
for ip in $IPS $EXTRA_IPS; do echo "  $ip"; done
echo

# ---- the school authority (created once) -----------------------------------
if [ ! -f ca.key ] || [ ! -f ca.crt ]; then
  echo "Creating the school certificate authority…"
  openssl genrsa -out ca.key 4096 2>/dev/null
  openssl req -x509 -new -nodes -key ca.key -sha256 -days "$DAYS_CA" -out ca.crt \
    -subj "/CN=Morris Multi Maths School Authority/O=Morris Multi Maths" 2>/dev/null
else
  echo "Reusing the existing school certificate authority (ca.crt)."
fi

# ---- the server certificate -------------------------------------------------
cat > server.cnf <<EOF
[req]
distinguished_name = dn
req_extensions     = ext
prompt             = no
[dn]
CN = Morris Multi Maths
O  = ${HOSTNAME_SHORT}
[ext]
basicConstraints = CA:FALSE
keyUsage         = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName   = @alt
[alt]
${ALT}
EOF

echo "Creating the server certificate…"
openssl genrsa -out server.key 2048 2>/dev/null
openssl req -new -key server.key -out server.csr -config server.cnf 2>/dev/null
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out server.crt -days "$DAYS_SERVER" -sha256 \
  -extfile server.cnf -extensions ext 2>/dev/null
rm -f server.csr

chmod 600 server.key ca.key 2>/dev/null || true

cat <<EOF

Done. Files are in: $CERTS

  ca.crt       → give this ONE file to your IT team.
                 They install it as a trusted root certificate on student
                 devices (Intune, Jamf, Group Policy, or by hand). After that,
                 students see no warnings at all.

  server.crt   → used by the server. Nothing to do with it.
  server.key   → the private key. Never share this file.

Next:
  node server.js
  then open the https:// address it prints.

If the laptop's IP address changes, run this script again and restart the
server. Students do NOT need anything reinstalled — ca.crt stays valid.
EOF
