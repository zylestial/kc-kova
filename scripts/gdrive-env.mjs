// Turns GDRIVE_TOKEN (the line `rclone authorize` prints: base64 JSON with
// the OAuth client and its token) into rclone's environment settings for the
// "gdrive" remote, printed as shell `export`s for .github/workflows/backup.yml
// to eval. Each value is masked in the Actions log first.
const blob = (process.env.GDRIVE_TOKEN ?? "").trim();
if (!blob) {
  console.error("GDRIVE_TOKEN is not set");
  process.exit(1);
}
// An older rclone prints the token JSON itself rather than base64.
const auth = blob.startsWith("{") ? { token: blob } : JSON.parse(Buffer.from(blob, "base64url").toString("utf8"));
const token = typeof auth.token === "string" ? auth.token : JSON.stringify(auth.token);
const quote = (value) => `'${String(value).replaceAll("'", `'\\''`)}'`;
const settings = { CLIENT_ID: auth.client_id, CLIENT_SECRET: auth.client_secret, TOKEN: token };
for (const [name, value] of Object.entries(settings)) {
  if (!value) continue;
  console.log(`echo ${quote(`::add-mask::${value}`)}`);
  console.log(`export RCLONE_CONFIG_GDRIVE_${name}=${quote(value)}`);
}
