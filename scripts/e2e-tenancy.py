#!/usr/bin/env python3
"""Tenant-isolation / auth regression against a RUNNING web app (default http://localhost:3100 from scripts/dc).
Drives the real forms like a browser (hidden server-action fields included), with no-JS form posts.
Covers: role guards, two users cannot see/act on each other's data (incl. replayed foreign action forms),
reseller subtree scope, package limits, impersonation, suspend, TOTP 2FA + replay, audit scoping.
Usage: python3 scripts/e2e-tenancy.py [BASE_URL]   (admin: ADMIN_LOGIN / ADMIN_PASSWORD env, default admin@test.local / supersecretadmin)
Re-runnable: every run uses a fresh random suffix for usernames/domains."""
import hashlib, hmac, html, os, re, struct, sys, time, uuid, urllib.parse, urllib.request, urllib.error, base64

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3100").rstrip("/")
ADMIN = (os.environ.get("ADMIN_LOGIN", "admin@test.local"), os.environ.get("ADMIN_PASSWORD", "supersecretadmin"))
PW = "correct-horse-battery"
SUF = uuid.uuid4().hex[:5]
ok = True
def check(name, cond, extra=""):
    global ok; ok &= bool(cond); print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"   <-- {extra}"))

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k): return None
opener = urllib.request.build_opener(NoRedirect)

class Client:
    def __init__(self): self.cookies = {}
    def _req(self, method, path, body=None, headers=None):
        h = {"Cookie": "; ".join(f"{k}={v}" for k, v in self.cookies.items()), "Origin": BASE, **(headers or {})}
        req = urllib.request.Request(BASE + path, data=body, method=method, headers=h)
        try: r = opener.open(req, timeout=60)
        except urllib.error.HTTPError as e: r = e
        for c in r.headers.get_all("Set-Cookie") or []:
            name, _, rest = c.split(";")[0].partition("=")
            if "Max-Age=0" in c or "1970" in c or rest == "": self.cookies.pop(name, None)
            else: self.cookies[name] = rest
        return r.status, r.headers.get("Location", ""), r.read().decode("utf-8", "replace")
    def get(self, path): return self._req("GET", path)
    def post_form(self, path, fields):
        b = "----e2e" + uuid.uuid4().hex
        body = "".join(f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n' for k, v in fields.items()) + f"--{b}--\r\n"
        return self._req("POST", path, body.encode(), {"Content-Type": f"multipart/form-data; boundary={b}"})

def forms(page):
    out = []
    for m in re.finditer(r"<form\b(.*?)>(.*?)</form>", page, re.S):
        inner = m.group(2); hidden = {}
        for t in re.finditer(r"<input\b([^>]*)>", inner):
            a = dict((k, html.unescape(v)) for k, v in re.findall(r'([\w:-]+)="([^"]*)"', t.group(1)))
            if a.get("type") == "hidden" and "name" in a: hidden[a["name"]] = a.get("value", "")
        out.append((inner, hidden))
    return out

def submit(c, page_path, marker, fields=None, post_to=None):
    """Find the form on page_path whose HTML contains `marker`, fill `fields`, post it. Returns (status, location)."""
    st, _, page = c.get(page_path)
    assert st == 200, f"GET {page_path} -> {st}"
    for inner, hidden in forms(page):
        if marker in inner:
            s, loc, _ = c.post_form(post_to or page_path, {**hidden, **(fields or {})}); return s, urllib.parse.unquote_plus(loc)
    raise AssertionError(f"form with {marker!r} not found on {page_path}")

def login(who, pw=PW):
    c = Client(); s, loc, _ = c.post_form("/login", {**forms(c.get("/login")[2])[0][1], "login": who, "password": pw}); return c, loc

def totp(secret, step):
    key = base64.b32decode(secret.upper() + "=" * (-len(secret) % 8))
    h = hmac.new(key, struct.pack(">Q", step), hashlib.sha1).digest(); o = h[-1] & 15
    return str((struct.unpack(">I", h[o:o + 4])[0] & 0x7FFFFFFF) % 10**6).zfill(6)

# ---------------------------------------------------------------- setup (as admin)
admin, loc = login(*ADMIN); check("admin login -> /admin", loc.endswith("/admin"), loc)
U1, U2, R1, RU = f"usera{SUF}", f"userb{SUF}", f"resel{SUF}", f"resu{SUF}"
D1, D2, D3 = f"a-{SUF}.test", f"b-{SUF}.test", f"c-{SUF}.test"
s, loc = submit(admin, "/admin/packages", "Create package", {"name": f"small{SUF}", "maxDomains": "1", "maxMailboxes": "1"}); check("admin creates package", "ok=" in loc, loc)
pkg_id = re.search(rf'<option value="([^"]+)"[^>]*>small{SUF}', admin.get("/admin/accounts")[2]).group(1)
def create_account(c, username, role, pkg=None, parent=None):
    f = {"username": username, "email": f"{username}@t.test", "password": PW, "role": role, "packageId": pkg or "", **({"parentId": parent} if parent else {})}
    return submit(c, "/admin/accounts", "Create</button>", f)
s, loc = create_account(admin, U1, "user", pkg_id); check("admin creates user A (limited package)", "/admin/accounts/" in loc and "ok=" in loc, loc)
s, loc = create_account(admin, U2, "user"); check("admin creates user B (unlimited)", "ok=" in loc, loc)
s, loc = create_account(admin, R1, "reseller"); check("admin creates reseller", "ok=" in loc, loc)
accounts_html = admin.get("/admin/accounts")[2]
id_of = lambda name: re.search(rf'href="/admin/accounts/([^"]+)"><b>{name}</b>', accounts_html).group(1)
res, loc = login(R1); check("reseller login -> /admin", loc.endswith("/admin"), loc)
s, loc = submit(res, "/admin/packages", "Create package", {"name": "rp"}); check("reseller creates own package", "ok=" in loc, loc)
rp_id = re.search(r'<option value="([^"]+)"[^>]*>rp<', res.get("/admin/accounts")[2]).group(1)
s, loc = create_account(res, RU, "user", rp_id); check("reseller creates its user", "ok=" in loc, loc)

# ---------------------------------------------------------------- role guards
a, loc = login(U1); check("user login -> /cpanel", loc.endswith("/cpanel"), loc)
b, _ = login(U2)
check("user home renders tiles", 'data-tile' in a.get("/cpanel")[2])
s, loc, _ = a.get("/admin"); check("user cannot open /admin (redirected to /cpanel)", s in (302, 307) and loc.endswith("/cpanel"), f"{s} {loc}")
s, loc, _ = a.get("/admin/accounts"); check("user cannot open /admin/accounts", s in (302, 307), s)
s, loc, _ = res.get("/cpanel"); check("reseller cannot open /cpanel", s in (302, 307) and loc.endswith("/admin"), f"{s} {loc}")
s, loc, _ = res.get("/admin/server"); check("reseller cannot open /admin/server", s in (302, 307), s)
s, loc, _ = res.get("/admin/logs"); check("reseller cannot open /admin/logs", s in (302, 307), s)
s, loc, _ = Client().get("/cpanel"); check("anonymous /cpanel -> /login", s in (302, 307) and "/login" in loc, f"{s} {loc}")
c_, loc = login(U1, "wrong-password-here"); check("bad password rejected", "/login?error=" in loc, loc)

# ---------------------------------------------------------------- two users cannot see or touch each other's data
s, loc = submit(a, "/cpanel/domains", "Add domain", {"name": D1}); check("user A adds domain", "/cpanel/domains/" in loc and "ok=" in loc, loc)
s, loc = submit(b, "/cpanel/domains", "Add domain", {"name": D2}); check("user B adds domain", "ok=" in loc, loc)
d2_id = re.search(r"/cpanel/domains/([^/?]+)", loc).group(1)
check("A's domain list has only A's domain", D1 in a.get("/cpanel/domains")[2] and D2 not in a.get("/cpanel/domains")[2])
check("B's domain list has only B's domain", D2 in b.get("/cpanel/domains")[2] and D1 not in b.get("/cpanel/domains")[2])
s, _, _ = a.get(f"/cpanel/domains/{d2_id}"); check("A opening B's domain page -> 404", s == 404, s)
# Replay B's own "delete domain" form (real, signed action fields) with A's session: must be refused.
_, hidden = next(f for f in forms(b.get(f"/cpanel/domains/{d2_id}")[2]) if "Delete domain and all mail" in f[0])
s, loc, _ = a.post_form("/cpanel/domains", hidden); loc = urllib.parse.unquote_plus(loc)
check("A replaying B's delete-domain form is refused", "error=Not found" in loc, loc)
check("B's domain still exists", D2 in admin.get("/admin/domains")[2])
# Same for an owner override on create: A tries to create a domain owned by B (ownerId field)
b_id = re.search(rf'href="/admin/accounts/([^"]+)"><b>{U2}</b>', admin.get("/admin/accounts")[2]).group(1)
s, loc = submit(a, "/cpanel/domains", "Add domain", {"name": D3, "ownerId": b_id}); check("A cannot create a domain owned by B", "error=Not found" in loc, loc)
check("...and nothing was created", D3 not in admin.get("/admin/domains")[2])
# mailboxes & aliases: A cannot create in B's domain (replay B's create form)
_, hb = next(f for f in forms(b.get("/cpanel/mailboxes")[2]) if "Create mailbox" in f[0] or 'name="localPart"' in f[0])
b_dom_id = d2_id
s, loc, _ = a.post_form("/cpanel/mailboxes", {**hb, "localPart": "evil", "password": PW, "domainId": b_dom_id}); loc = urllib.parse.unquote_plus(loc)
check("A cannot create a mailbox in B's domain", "error=Not found" in loc, loc)
s, loc = submit(b, "/cpanel/mailboxes", 'name="localPart"', {"localPart": "bob", "password": PW, "domainId": b_dom_id}); check("B creates mailbox in own domain", "ok=" in loc, loc)
check("A does not see B's mailbox", "bob@" not in a.get("/cpanel/mailboxes")[2])

# ---------------------------------------------------------------- package limits (A: 1 domain, 1 mailbox)
s, loc = submit(a, "/cpanel/domains", "Add domain", {"name": D3}); check("A's 2nd domain blocked by package", "Package limit reached" in loc, loc)
d1_id = re.search(rf'/cpanel/domains/([^"]+)"><b>{re.escape(D1)}', a.get("/cpanel/domains")[2]).group(1)
s, loc = submit(a, "/cpanel/mailboxes", 'name="localPart"', {"localPart": "one", "password": PW, "domainId": d1_id}); check("A's 1st mailbox ok", "ok=" in loc, loc)
s, loc = submit(a, "/cpanel/mailboxes", 'name="localPart"', {"localPart": "two", "password": PW, "domainId": d1_id}); check("A's 2nd mailbox blocked by package", "Package limit reached" in loc, loc)

# ---------------------------------------------------------------- reseller subtree
ra = res.get("/admin/accounts")[2]
check("reseller sees own customer", RU in ra)
check("reseller does NOT see other accounts", U1 not in ra and U2 not in ra)
s, _, _ = res.get(f"/admin/accounts/{id_of(U1)}"); check("reseller opening unrelated account -> 404", s == 404, s)
check("reseller domain list excludes other tenants", D1 not in res.get("/admin/domains")[2] and D2 not in res.get("/admin/domains")[2])
check("reseller cannot use admin's package", 'small' not in res.get("/admin/packages")[2])
s, loc = submit(res, "/admin/accounts", "Create</button>", {"username": f"x{SUF}", "email": f"x{SUF}@t.test", "password": PW, "role": "reseller", "packageId": rp_id}); check("reseller cannot create a reseller", "error=" in loc, loc)
# reseller replays admin's suspend form for user A
_, hs = next(f for f in forms(admin.get(f"/admin/accounts/{id_of(U1)}")[2]) if 'name="reason"' in f[0])
s, loc, _ = res.post_form("/admin/accounts", {**hs, "reason": "hax"}); loc = urllib.parse.unquote_plus(loc)
check("reseller replaying admin's suspend form for a foreign account is refused", "error=Not found" in loc, loc)
check("user A still active", a.get("/cpanel")[0] == 200)

# ---------------------------------------------------------------- impersonation
ru_id = re.search(rf'href="/admin/accounts/([^"]+)"><b>{RU}</b>', ra).group(1)
s, loc = submit(res, f"/admin/accounts/{ru_id}", "Log in as", None); check("reseller impersonates its user -> /cpanel", loc.endswith("/cpanel"), loc)
page = res.get("/cpanel")[2]; check("impersonation banner shown", "Return to my account" in page and RU in page)
check("security settings locked while impersonating", "can only be changed by the account owner" in res.get("/cpanel/account")[2])
s, loc = submit(res, "/cpanel", "Return to my account"); check("return to own account", "/admin/accounts/" in loc, loc)
check("reseller is back in /admin", res.get("/admin")[0] == 200)
s, loc = submit(admin, f"/admin/accounts/{id_of(U2)}", "Log in as"); check("admin impersonates any user", loc.endswith("/cpanel"), loc)
submit(admin, "/cpanel", "Return to my account")

# ---------------------------------------------------------------- suspend / unsuspend
s, loc = submit(admin, f"/admin/accounts/{id_of(U1)}", 'name="reason"', {"reason": "test"}); check("admin suspends A", "ok=" in loc, loc)
s, loc, _ = a.get("/cpanel"); check("suspended user's existing session is dead", s in (302, 307) and "/login" in loc, f"{s} {loc}")
_, loc = login(U1); check("suspended user cannot sign in", "suspended" in loc, loc)
submit(admin, f"/admin/accounts/{id_of(U1)}", "Unsuspend"); _, loc = login(U1); check("unsuspend restores sign-in", loc.endswith("/cpanel"), loc)

# ---------------------------------------------------------------- 2FA (user B)
b, _ = login(U2)
submit(b, "/cpanel/account", "Set up two-factor")
secret = re.search(r'Enter this key manually: <span class="mono">([A-Z2-7]+)</span>', b.get("/cpanel/account")[2]).group(1)
step = int(time.time() // 30)
s, loc = submit(b, "/cpanel/account", 'name="code"', {"code": totp(secret, step)}); check("2FA enable with valid code", "ok=" in loc, loc)
codes = re.findall(r"<div>([0-9a-f]{5}-[0-9a-f]{5})</div>", b.get("/cpanel/account")[2]); check("8 recovery codes shown once", len(codes) == 8, codes)
c2, loc = login(U2); check("login now asks for 2FA", loc.endswith("/login/2fa"), loc)
s, loc = submit(c2, "/login/2fa", 'name="code"', {"code": "000000"}); check("wrong 2FA code rejected", "error=" in loc, loc)
s, loc = submit(c2, "/login/2fa", 'name="code"', {"code": totp(secret, step)}); check("replay of the enrol code rejected", "error=" in loc, loc)
s, loc = submit(c2, "/login/2fa", 'name="code"', {"code": totp(secret, step + 1)}); check("fresh TOTP code accepted", loc.endswith("/cpanel"), loc)
check("session works after 2FA", c2.get("/cpanel")[0] == 200)
c3, _ = login(U2); s, loc = submit(c3, "/login/2fa", 'name="code"', {"code": codes[0]}); check("recovery code accepted", loc.endswith("/cpanel"), loc)
c4, _ = login(U2); s, loc = submit(c4, "/login/2fa", 'name="code"', {"code": codes[0]}); check("recovery code is single-use", "error=" in loc, loc)
s, _, _ = Client().get("/login/2fa"); check("/login/2fa without pending login -> /login", s in (302, 307), s)

# ---------------------------------------------------------------- sites (works without an agent: the row is created, deploy just fails)
SD1, SD2 = f"sitea{SUF}.example.com", f"siteb{SUF}.example.com"
s, loc = submit(a, "/cpanel/sites", "Create site", {"name": "blog", "domain": SD1, "runtime": "static"}); check("user A creates a site", re.search(r"/cpanel/sites/[^/?]+", loc) is not None, loc)
site_a = re.search(r"/cpanel/sites/([^/?]+)", loc).group(1)
s, loc = submit(b, "/cpanel/sites", "Create site", {"name": "blog", "domain": SD2, "runtime": "static"}); check("user B creates a site with the same name", re.search(r"/cpanel/sites/[^/?]+", loc) is not None, loc)
site_b = re.search(r"/cpanel/sites/([^/?]+)", loc).group(1)
s, loc = submit(b, "/cpanel/sites", "Create site", {"name": "other", "domain": SD1, "runtime": "static"}); check("B cannot claim A's domain", "already used" in loc, loc)
check("A's site list excludes B's site", SD1 in a.get("/cpanel/sites")[2] and SD2 not in a.get("/cpanel/sites")[2])
s, _, _ = a.get(f"/cpanel/sites/{site_b}"); check("A opening B's site page -> 404", s == 404, s)
_, hidden = next(f for f in forms(b.get(f"/cpanel/sites/{site_b}")[2]) if "Save environment" in f[0])
s, loc, _ = a.post_form(f"/cpanel/sites/{site_b}", hidden); loc = urllib.parse.unquote_plus(loc)
check("A replaying B's env form is refused", "error=Not found" in loc, loc)
_, hidden = next(f for f in forms(b.get(f"/cpanel/sites/{site_b}")[2]) if "also delete files" in f[0])
s, loc, _ = a.post_form("/cpanel/sites", {**hidden, "confirm": "blog"}); loc = urllib.parse.unquote_plus(loc)
check("A replaying B's delete-site form is refused", "error=Not found" in loc, loc)
check("B's site still exists", SD2 in admin.get("/admin/sites")[2])
check("reseller site list excludes other tenants", SD1 not in res.get("/admin/sites")[2] and SD2 not in res.get("/admin/sites")[2])
s, loc = submit(a, "/cpanel/sites", "Create site", {"name": "x", "domain": f"x{SUF}.example.com", "runtime": "static", "ownerId": b_id}); check("A cannot create a site owned by B", "error=Not found" in loc, loc)

# ---------------------------------------------------------------- malware scans (no agent needed: the ScanRun row is created before the agent is called)
_, hidden = next(f for f in forms(b.get(f"/cpanel/sites/{site_b}")[2]) if "Scan now" in f[0])
s, loc, _ = a.post_form(f"/cpanel/sites/{site_b}", hidden); loc = urllib.parse.unquote_plus(loc)
check("A replaying B's scan-now form is refused", "error=Not found" in loc, loc)
_, hidden = next(f for f in forms(b.get(f"/cpanel/sites/{site_b}")[2]) if "Scan now" in f[0])
s, loc, _ = b.post_form(f"/cpanel/sites/{site_b}", hidden); loc = urllib.parse.unquote_plus(loc)
check("B can scan their own site", "ok=" in loc, loc)

# ---------------------------------------------------------------- files + databases (no agent needed: ownership is checked before any agent call)
s, _, _ = a.get(f"/cpanel/files?site={site_b}"); check("A opening B's file manager -> 404", s == 404, s)
_, hidden = next(f for f in forms(b.get(f"/cpanel/files?site={site_b}")[2]) if "New folder" in f[0])
s, loc, _ = a.post_form("/cpanel/files", {**hidden, "dir": "/", "name": "pwned"}); loc = urllib.parse.unquote_plus(loc)
check("A replaying B's new-folder form is refused", "error=Not found" in loc, loc)
check("A's files site picker excludes B's site", f'value="{site_b}"' not in a.get("/cpanel/files")[2] and f'value="{site_a}"' in a.get("/cpanel/files")[2])
s, loc = submit(a, "/cpanel/databases", "Create database", {"engine": "mariadb", "name": "x", "ownerId": b_id}); check("A cannot create a database owned by B", "error=Not found" in loc, loc)
s, loc = submit(a, "/cpanel/databases", "Create database", {"engine": "oracle", "name": "x"}); check("unknown engine rejected", "error=" in loc, loc)
s, loc = submit(a, "/cpanel/databases", "Create database", {"engine": "mariadb", "name": "bad;name"}); check("bad database name rejected", "error=" in loc, loc)

# ---------------------------------------------------------------- audit scoping
aa = a.get("/cpanel/activity")[2]
check("user A's activity shows own events", "domain.create" in aa and D1 in aa)
check("user A's activity does NOT show B's events", D2 not in aa and "bob@" not in aa and f"@{D2}" not in aa)
adm = admin.get("/admin/audit")[2]
check("audit records the isolation probes", "domain.create" in adm)
check("admin audit shows everything", D1 in adm and D2 in adm and "impersonate.start" in adm and "account.suspend" in adm and "auth.2fa_failed" in adm)
check("reseller audit excludes other tenants", D1 not in res.get("/admin/audit")[2] and "account.create" in res.get("/admin/audit")[2])

print("\nALL PASS" if ok else "\nFAILURES ABOVE"); sys.exit(0 if ok else 1)
