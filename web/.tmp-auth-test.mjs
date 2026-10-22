// Prove the stored mailbox credentials authenticate against Microsoft 365.
// NOOP only: no message is sent. If this fails, nothing else matters.
import net from "node:net";
import tls from "node:tls";
import crypto from "node:crypto";
import Database from "better-sqlite3";

const DB_PATH = process.argv[2];
if (!DB_PATH) throw new Error("usage: node auth-test.mjs <path-to-sqlite>");
console.log("using DB:", DB_PATH);
const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
const rows = db.prepare("SELECT * FROM mailboxes ORDER BY mailbox_id").all();
db.close();

function readUntil(socket, marker) {
  return new Promise((resolve, reject) => {
    let buf = "";
    const onData = (d) => {
      buf += d.toString();
      // Multi-line SMTP replies: "250-EXT\r\n250 OK"
      const lines = buf.trim().split(/\r?\n/);
      if (lines.length && /^\d{3} /.test(lines[lines.length - 1])) {
        socket.off("data", onData);
        socket.off("error", onErr);
        socket.off("timeout", onErr);
        resolve({ buf, code: parseInt(lines[lines.length - 1].slice(0, 3), 10) });
      }
    };
    const onErr = (e) => {
      socket.off("data", onData);
      socket.off("error", onErr);
      socket.off("timeout", onErr);
      reject(e);
    };
    socket.on("data", onData);
    socket.on("error", onErr);
    socket.on("timeout", onErr);
    socket.setTimeout(30000);
  });
}

async function testMailbox(mb) {
  console.log(`\n--- ${mb.email} (smtp_user=${mb.smtp_user}) ---`);
  return new Promise(async (resolve) => {
    let socket;
    try {
      socket = net.connect({ host: mb.smtp_server, port: mb.smtp_port, timeout: 30000 });
      await new Promise((r, j) => {
        socket.once("secureConnect", r);
        socket.once("connect", r);
        socket.once("error", j);
      });

      let greeting = await readUntil(socket);
      console.log(`  greeting: ${greeting.code}`);

      socket.write("EHLO localhost\r\n");
      let ehlo = await readUntil(socket);
      console.log(`  EHLO: ${ehlo.code}`);

      const supportsStartTls = /STARTTLS/i.test(ehlo.buf);
      console.log(`  STARTTLS offered: ${supportsStartTls}`);
      if (!supportsStartTls) {
        console.log("  RESULT: no STARTTLS -> cannot proceed");
        return resolve({ ok: false, why: "no_starttls" });
      }

      socket.write("STARTTLS\r\n");
      let tlsResp = await readUntil(socket);
      console.log(`  STARTTLS: ${tlsResp.code}`);
      if (tlsResp.code !== 220) {
        console.log("  RESULT: STARTTLS refused");
        return resolve({ ok: false, why: "starttls_refused" });
      }

      // Upgrade the existing socket to TLS in place.
      const secure = tls.connect(
        { socket, servername: mb.smtp_server, rejectUnauthorized: false },
        () => console.log("  TLS established"),
      );
      await new Promise((r, j) => {
        secure.once("secureConnect", r);
        secure.once("error", j);
      });

      secure.write("EHLO localhost\r\n");
      await readUntil(secure);

      // AUTH LOGIN
      secure.write("AUTH LOGIN\r\n");
      let a1 = await readUntil(secure);
      if (a1.code !== 334) {
        console.log(`  AUTH LOGIN refused: ${a1.code}`);
        secure.write("QUIT\r\n");
        return resolve({ ok: false, why: `auth_login_${a1.code}` });
      }

      const b64user = Buffer.from(mb.smtp_user, "utf8").toString("base64");
      const b64pass = Buffer.from(mb.smtp_password, "utf8").toString("base64");

      secure.write(`${b64user}\r\n`);
      let a2 = await readUntil(secure);
      if (a2.code !== 334) {
        console.log(`  username rejected: ${a2.code} ${a2.buf.trim().slice(0, 80)}`);
        secure.write("QUIT\r\n");
        return resolve({ ok: false, why: `username_${a2.code}` });
      }

      secure.write(`${b64pass}\r\n`);
      let a3 = await readUntil(secure);
      const ok = a3.code === 235;
      console.log(`  AUTH result: ${a3.code} ${ok ? "SUCCESS" : a3.buf.trim().slice(0, 90)}`);
      secure.write("QUIT\r\n");
      secure.end();
      resolve({ ok, why: ok ? "authenticated" : `auth_${a3.code}` });
    } catch (err) {
      console.log(`  ERROR: ${err.code || err.message}`);
      try { socket?.destroy(); } catch {}
      resolve({ ok: false, why: err.code || "exception" });
    }
  });
}

for (const mb of rows) {
  const r = await testMailbox(mb);
  console.log(`  => ${mb.email}: ${r.ok ? "CAN SEND" : "CANNOT SEND (" + r.why + ")"}`);
}