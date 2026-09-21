#!/usr/bin/env python3
"""Mail regression test against the local stack (scripts/dc up -d --build).
Seeds example.test + alice/bob + support alias, then checks: authenticated send, delivery via IMAP,
sender-spoof rejection, bad-login rejection, DKIM signature. Exit code != 0 on failure."""
import imaplib, smtplib, ssl, subprocess, sys, time
ctx = ssl._create_unverified_context()
PW = "password1234"
ok = True
def check(name, cond):
    global ok; ok &= bool(cond); print(("PASS " if cond else "FAIL ") + name)

SEED = r'''
const { PrismaClient } = require("@prisma/client"); const bcrypt = require("bcryptjs"); const crypto = require("crypto");
(async () => { const p = new PrismaClient();
  if (await p.domain.findUnique({ where: { name: "example.test" } })) return p.$disconnect();
  const k = crypto.generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "der" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
  const d = await p.domain.create({ data: { name: "example.test", dkimPublicKey: k.publicKey.toString("base64"), dkimPrivateKey: k.privateKey } });
  const h = "{BLF-CRYPT}" + (await bcrypt.hash("password1234", 10)).replace(/^\$2[ab]\$/, "$2y$");
  for (const n of ["alice", "bob"]) await p.mailbox.create({ data: { domainId: d.id, localPart: n, email: n + "@example.test", passwordHash: h, quotaMb: 100 } });
  await p.alias.create({ data: { domainId: d.id, source: "support@example.test", destinations: ["bob@example.test"] } });
  await p.$disconnect(); })();
'''
def dc(*a, **k): return subprocess.run(["scripts/dc", *a], capture_output=True, text=True, **k)
open("/tmp/seed-e2e.cjs", "w").write(SEED)
subprocess.run(["docker", "cp", "/tmp/seed-e2e.cjs", "mailhost-web-1:/app/seed.cjs"], check=True)
subprocess.run(["docker", "exec", "mailhost-web-1", "sh", "-c", "node seed.cjs"], check=True)
subprocess.run(["docker", "restart", "mailhost-web-1"], capture_output=True); time.sleep(20)  # re-syncs DKIM key files

def smtp():
    m = smtplib.SMTP("localhost", 2587); m.starttls(context=ctx); return m
subj = f"e2e-{int(time.time())}"
m = smtp(); m.login("alice@example.test", PW)
m.sendmail("alice@example.test", ["bob@example.test", "support@example.test"], f"From: alice@example.test\r\nTo: bob@example.test\r\nSubject: {subj}\r\n\r\nbody\r\n"); m.quit()
check("authenticated send accepted", True)
try:
    m = smtp(); m.login("alice@example.test", PW); m.sendmail("bob@example.test", ["alice@example.test"], "Subject: x\r\n\r\nx"); check("sender spoof rejected", False)
except smtplib.SMTPSenderRefused: check("sender spoof rejected", True)
try:
    m = smtp(); m.login("alice@example.test", "wrong"); check("bad login rejected", False)
except smtplib.SMTPAuthenticationError: check("bad login rejected", True)
time.sleep(8)
i = imaplib.IMAP4_SSL("localhost", 2993, ssl_context=ctx); i.login("bob@example.test", PW); i.select("INBOX")
typ, ids = i.search(None, "SUBJECT", subj); check("delivered to bob (IMAP)", bool(ids[0]))
raw = i.fetch(ids[0].split()[0], "(BODY.PEEK[HEADER])")[1][0][1].decode() if ids[0] else ""
check("DKIM-Signature present (d=example.test)", "DKIM-Signature" in raw and "d=example.test" in raw)
sys.exit(0 if ok else 1)
