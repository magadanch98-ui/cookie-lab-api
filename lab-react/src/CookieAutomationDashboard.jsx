import React, { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Play, RefreshCw, Globe, ShieldCheck, Cookie, History, Link2, Layers3 } from "lucide-react";

function rand(len = 12) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

const regionProfiles = {
  MX: { locale: "es_MX", currency: "MXN", region: "mx", country: "Mexico" },
  US: { locale: "en_US", currency: "USD", region: "us", country: "United States" },
  ES: { locale: "es_ES", currency: "EUR", region: "es", country: "Espana" },
  IT: { locale: "it_IT", currency: "EUR", region: "it", country: "Italia" },
  CA: { locale: "en_CA", currency: "CAD", region: "ca", country: "Canada" }
};

function createWallet(alias = "Wallet") {
  return {
    wallet_id: `wallet_${rand(8)}`,
    wallet_alias: alias,
    wallet_state: "wallet_created"
  };
}

function createDemoSource() {
  return {
    source_id: `source_${rand(10)}`,
    source_type: "credential",
    source_state: "source_created",
    validation_state: "valid_format"
  };
}

function generateCookies(profile, wallet, source) {
  return {
    locale: profile.locale,
    pref_currency: profile.currency,
    region: profile.region,
    country: profile.country,
    wallet_id: wallet.wallet_id,
    wallet_state: wallet.wallet_state,
    source_id: source.source_id,
    source_state: source.source_state,
    session_id: `session_${rand(12)}`,
    auth_token: `auth_${rand(20)}`,
    last_seen: String(Date.now()),
    metrics: `metrics_${rand(6)}_${Date.now()}`
  };
}

function cookieString(obj) {
  return Object.entries(obj)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

function classifyCookie(name) {
  if (["locale", "pref_currency", "region", "country"].includes(name)) return "Regional";
  if (["wallet_id", "wallet_state", "source_id", "source_state"].includes(name)) return "Entidad";
  if (["session_id", "auth_token", "last_seen", "metrics"].includes(name)) return "Sesion";
  return "General";
}

export default function DemoCookieAutomationDashboard() {
  const [regionKey, setRegionKey] = useState("MX");
  const [walletAlias, setWalletAlias] = useState("Wallet");
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);

  function pushHistory(type, payload) {
    setHistory((prev) => [
      {
        id: `${type}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        type,
        at: new Date().toLocaleTimeString(),
        payload
      },
      ...prev
    ].slice(0, 12));
  }

  function runAutomation() {
    const profile = regionProfiles[regionKey];
    const wallet = createWallet(walletAlias || "Wallet");
    const source = createDemoSource();

    wallet.wallet_state = "wallet_active";
    source.source_state = "source_linked";

    const cookies = generateCookies(profile, wallet, source);
    const next = { profile, wallet, source, cookies, lab_state: "session_active" };

    setResult(next);
    pushHistory("AUTOMATION_RUN", next);
  }

  function refreshSession() {
    if (!result) return;
    const updated = {
      ...result,
      cookies: {
        ...result.cookies,
        session_id: `session_${rand(12)}`,
        auth_token: `auth_${rand(20)}`,
        last_seen: String(Date.now()),
        metrics: `metrics_${rand(6)}_${Date.now()}`
      }
    };
    setResult(updated);
    pushHistory("SESSION_REFRESH", updated.cookies);
  }

  function unlinkSource() {
    if (!result) return;
    const updated = {
      ...result,
      source: {
        ...result.source,
        source_state: "source_removed"
      }
    };
    updated.cookies = {
      ...updated.cookies,
      source_state: "source_removed",
      last_seen: String(Date.now())
    };
    setResult(updated);
    pushHistory("SOURCE_UNLINKED", updated.source);
  }

  function clearLab() {
    setResult(null);
    pushHistory("LAB_CLEARED", { ok: true });
  }

  const cookieRows = useMemo(() => {
    if (!result?.cookies) return [];
    return Object.entries(result.cookies).map(([name, value]) => ({
      name,
      value,
      kind: classifyCookie(name)
    }));
  }, [result]);

  return (
    <div className="app-shell">
      <div className="container stack-lg">
        <Card>
          <CardHeader>
            <div className="row between wrap gap-md">
              <div>
                <CardTitle>Local Environment</CardTitle>
                <p className="muted">Cookie generator + automatizacion por region para wallet/source.</p>
              </div>
              <Badge>wallets · payments</Badge>
            </div>
          </CardHeader>

          <CardContent>
            <div className="controls-grid">
              <div className="field">
                <label className="label">
                  <Globe size={15} /> Region para generar cookies
                </label>
                <select value={regionKey} onChange={(e) => setRegionKey(e.target.value)} className="input select">
                  <option value="MX">Mexico</option>
                  <option value="US">Estados Unidos</option>
                  <option value="ES">Espana</option>
                  <option value="IT">Italia</option>
                  <option value="CA">Canada</option>
                </select>
              </div>

              <div className="field">
                <label className="label">
                  <Layers3 size={15} /> Alias del wallet
                </label>
                <Input value={walletAlias} onChange={(e) => setWalletAlias(e.target.value)} placeholder="Wallet" />
              </div>

              <div className="field end">
                <Button onClick={runAutomation}>
                  <Play size={15} /> Generar cookies
                </Button>
              </div>
            </div>

            <div className="row wrap gap-sm top-sm">
              <Button variant="secondary" onClick={refreshSession} disabled={!result}>
                <RefreshCw size={15} /> Refrescar sesion
              </Button>
              <Button variant="secondary" onClick={unlinkSource} disabled={!result}>
                <Link2 size={15} /> Desvincular source
              </Button>
              <Button variant="destructive" onClick={clearLab}>
                Limpiar
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="two-col">
          <Card>
            <CardHeader>
              <CardTitle>
                <span className="title-inline"><ShieldCheck size={16} /> Estado del laboratorio</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="code-box">
                {result
                  ? JSON.stringify(result, null, 2)
                  : "Pulsa Generar cookies para crear perfil, wallet, source y cookies."}
              </pre>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                <span className="title-inline"><History size={16} /> Historial de eventos</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {history.length === 0 ? (
                <div className="muted">Todavia no hay eventos.</div>
              ) : (
                <div className="stack-sm scroll-box">
                  {history.map((item) => (
                    <div key={item.id} className="event-item">
                      <div className="row between">
                        <strong>{item.type}</strong>
                        <span className="muted mini">{item.at}</span>
                      </div>
                      <pre className="event-json">{JSON.stringify(item.payload, null, 2)}</pre>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="full">
            <CardHeader>
              <CardTitle>
                <span className="title-inline"><Cookie size={16} /> Cadena actual de cookies</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="code-box">{result?.cookies ? cookieString(result.cookies) : "No hay cookies activas."}</pre>
            </CardContent>
          </Card>

          <Card className="full">
            <CardHeader>
              <CardTitle>Mapa de cookies</CardTitle>
            </CardHeader>
            <CardContent>
              {cookieRows.length === 0 ? (
                <div className="muted">Aqui apareceran las cookies clasificadas por tipo.</div>
              ) : (
                <div className="stack-sm">
                  {cookieRows.map((row) => (
                    <div key={row.name} className="event-item">
                      <div className="row between wrap">
                        <strong className="break">{row.name}</strong>
                        <Badge variant="outline">{row.kind}</Badge>
                      </div>
                      <div className="mono break">{String(row.value)}</div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
