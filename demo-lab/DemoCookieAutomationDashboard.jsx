import React, { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Play,
  RefreshCw,
  Globe,
  ShieldCheck,
  Cookie,
  History,
  Link2,
  Layers3
} from "lucide-react";

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
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <Card className="bg-zinc-900/85 border-cyan-500/20 rounded-3xl shadow-2xl">
          <CardHeader>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <CardTitle className="text-3xl font-bold tracking-tight">LOCAL ENVIRONMENT</CardTitle>
                <p className="text-zinc-400 mt-2">Cookie generator + automatizacion para wallet y approved auth.</p>
              </div>
              <Badge className="bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">wallets · payments</Badge>
            </div>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-1">
              <div className="text-sm text-zinc-400 mb-2 flex items-center gap-2">
                <Globe className="w-4 h-4" /> Region para generar cookies
              </div>
              <select
                value={regionKey}
                onChange={(e) => setRegionKey(e.target.value)}
                className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
              >
                <option value="MX">Mexico</option>
                <option value="US">Estados Unidos</option>
                <option value="ES">Espana</option>
                <option value="IT">Italia</option>
                <option value="CA">Canada</option>
              </select>
            </div>

            <div className="md:col-span-1">
              <div className="text-sm text-zinc-400 mb-2 flex items-center gap-2">
                <Layers3 className="w-4 h-4" /> Alias del wallet
              </div>
              <Input
                value={walletAlias}
                onChange={(e) => setWalletAlias(e.target.value)}
                placeholder="Wallet"
                className="bg-zinc-950 border-zinc-700"
              />
            </div>

            <div className="md:col-span-1 flex items-end">
              <Button onClick={runAutomation} className="w-full bg-cyan-500 text-zinc-950 hover:bg-cyan-400">
                <Play className="w-4 h-4 mr-2" /> Generar cookies
              </Button>
            </div>

            <div className="md:col-span-3 flex flex-wrap gap-2 pt-1">
              <Button variant="secondary" onClick={refreshSession} disabled={!result}>
                <RefreshCw className="w-4 h-4 mr-2" /> Refrescar sesion
              </Button>
              <Button variant="secondary" onClick={unlinkSource} disabled={!result}>
                <Link2 className="w-4 h-4 mr-2" /> Desvincular source
              </Button>
              <Button variant="destructive" onClick={clearLab}>
                Limpiar
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="bg-zinc-900/85 border-zinc-800 rounded-3xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-cyan-400" /> Estado actual del laboratorio
              </CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="text-xs whitespace-pre-wrap break-all rounded-2xl bg-zinc-950 border border-zinc-800 p-4 leading-6 text-zinc-300">
                {result
                  ? JSON.stringify(result, null, 2)
                  : "Pulsa Generar cookies para crear perfil, wallet, source y cookies."}
              </pre>
            </CardContent>
          </Card>

          <Card className="bg-zinc-900/85 border-zinc-800 rounded-3xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="w-5 h-5 text-cyan-400" /> Historial de eventos
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 max-h-[420px] overflow-auto">
              {history.length === 0 ? (
                <div className="text-sm text-zinc-400">Todavia no hay eventos.</div>
              ) : (
                history.map((item) => (
                  <div key={item.id} className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-3">
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <div className="font-medium text-cyan-300">{item.type}</div>
                      <div className="text-xs text-zinc-500">{item.at}</div>
                    </div>
                    <pre className="text-[11px] whitespace-pre-wrap break-all text-zinc-300 leading-5">
                      {JSON.stringify(item.payload, null, 2)}
                    </pre>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="bg-zinc-900/85 border-zinc-800 rounded-3xl lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Cookie className="w-5 h-5 text-cyan-400" /> Cadena actual de cookies
              </CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="text-xs whitespace-pre-wrap break-all rounded-2xl bg-zinc-950 border border-zinc-800 p-4 leading-6 text-zinc-300">
                {result?.cookies ? cookieString(result.cookies) : "No hay cookies activas."}
              </pre>
            </CardContent>
          </Card>

          <Card className="bg-zinc-900/85 border-zinc-800 rounded-3xl lg:col-span-2">
            <CardHeader>
              <CardTitle>Mapa de cookies</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              {cookieRows.length === 0 ? (
                <div className="text-sm text-zinc-400">Aqui apareceran las cookies clasificadas por tipo.</div>
              ) : (
                cookieRows.map((row) => (
                  <div key={row.name} className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-3">
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <div className="font-medium text-cyan-300 break-all">{row.name}</div>
                      <Badge variant="outline" className="border-zinc-700 text-zinc-300">
                        {row.kind}
                      </Badge>
                    </div>
                    <div className="font-mono text-xs break-all text-zinc-300">{String(row.value)}</div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
