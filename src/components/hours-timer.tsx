"use client";
import { useEffect, useRef, useState } from "react";
import { Clock3, Loader2, Play, Square } from "lucide-react";
import type { Project, Timer } from "@/lib/types";
import { CatalogControls, useCatalog } from "./catalog";

async function timerRequest(path: string, body?: unknown) {
  const response = await fetch(path, body === undefined ? { cache: "no-store" } : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Não foi possível acessar o timer.");
  return result;
}

export function elapsedLabel(seconds: number) {
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map(value => String(value).padStart(2, "0")).join(":");
}

export function HoursTimer({ initialTimer, projects, visible, open, onSaved, onNewProject }: {
  initialTimer: Timer | null; projects: Project[]; visible: boolean; open: () => void;
  onSaved: () => Promise<void>; onNewProject: () => void;
}) {
  const [timer, setTimer] = useState(initialTimer);
  const [project, setProject] = useState("");
  const [description, setDescription] = useState("");
  const [now, setNow] = useState(0);
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const pending = useRef(false);
  const version = useRef(0);
  const startId = useRef<string | null>(null);
  const current = useRef(timer);
  const saved = useRef(onSaved);
  useEffect(() => { saved.current = onSaved; }, [onSaved]);
  useEffect(() => {
    let mounted = true;
    async function sync() {
      if (pending.current) return;
      const requestVersion = ++version.current;
      try {
        const result = await timerRequest("/api/timer");
        if (!mounted || pending.current || requestVersion !== version.current) return;
        const changed = current.current?.id !== result.timer?.id;
        const wasRunning = Boolean(current.current);
        current.current = result.timer;
        startId.current = null;
        setTimer(result.timer); setOffset(result.now - Date.now()); setReady(true);
        if (changed && wasRunning) {
          try { await saved.current(); } catch { setNeedsRefresh(true); }
        }
      } catch (error) {
        if (mounted && requestVersion === version.current) {
          setError(error instanceof Error ? error.message : "Não foi possível carregar o timer.");
        }
      }
    }
    setNow(Date.now());
    void sync();
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(() => { if (document.visibilityState === "visible") void sync(); }, 15000);
    const focus = () => { void sync(); };
    window.addEventListener("focus", focus);
    window.addEventListener("online", focus);
    return () => { mounted = false; clearInterval(tick); clearInterval(poll); window.removeEventListener("focus", focus); window.removeEventListener("online", focus); };
  }, []);

  const seconds = timer && now ? Math.max(0, Math.floor((now + offset - timer.started_at) / 1000)) : 0;
  const catalog=useCatalog("projects",visible,[],projects,"active");
  const active = catalog.projects.filter(value => value.status === "active");
  async function act(event: React.FormEvent) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true; ++version.current; setBusy(true); setError("");
    try {
      if (timer) {
        await timerRequest(`/api/timer/${timer.id}/stop`, {});
        current.current = null; setTimer(null); startId.current = null; setDescription("");
        try { await onSaved(); setNeedsRefresh(false); }
        catch { setNeedsRefresh(true); setError("Timer salvo. Não foi possível atualizar os registros; tente atualizar abaixo."); }
      } else {
        startId.current ??= crypto.randomUUID();
        const result = await timerRequest("/api/timer", { id: startId.current, project_id: project, description });
        current.current = result.timer; setTimer(result.timer); setOffset(result.now - Date.now()); setNow(Date.now());
        startId.current = null;
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "Não foi possível salvar. Tente novamente.");
    } finally { pending.current = false; setBusy(false); }
  }

  if (!visible) return timer ? <button className="running-timer-banner" onClick={open}><span className="timer-live-dot"/><Clock3 size={17}/><span>Timer em andamento · {timer.project_name}</span><strong>{elapsedLabel(seconds)}</strong><span>Abrir timer →</span></button> : null;

  return <section className={`panel timer-panel ${timer ? "is-running" : ""}`} aria-label="Cronômetro de trabalho">
    <div className="panel-heading"><div><h2>Seu tempo, no projeto certo</h2><p>Escolha o projeto, descreva a tarefa e comece.</p></div><span className={`badge ${timer ? "green" : "gray"}`}>{timer && <i/>}{timer ? "Em andamento" : "Pronto para começar"}</span></div>
    <form className="timer-form" onSubmit={act}>
      <CatalogControls catalog={catalog} label="projetos"/><div className="timer-fields"><label htmlFor="timer-project">Projeto<select id="timer-project" required value={timer?.project_id || project} disabled={Boolean(timer) || busy || !ready} onChange={event => setProject(event.target.value)}><option value="" disabled>Selecione um projeto</option>{(timer?.project_id||project)&&!catalog.projects.some(value=>value.id===(timer?.project_id||project))&&<option value={timer?.project_id||project}>{timer?.project_name||projects.find(value=>value.id===project)?.name||"Projeto selecionado"}</option>}{catalog.projects.filter(value => value.status === "active" || value.id === timer?.project_id).map(value => <option key={value.id} value={value.id}>{value.name} · {value.client_name}</option>)}</select></label>
      <label htmlFor="timer-description">O que você está fazendo?<textarea id="timer-description" required minLength={3} maxLength={1000} rows={2} value={timer?.description ?? description} disabled={Boolean(timer) || busy || !ready} onChange={event => setDescription(event.target.value)} placeholder="Ex.: Desenvolvimento da página inicial"/></label></div>
      <div className="timer-controls"><span className="timer-caption">{timer ? "TEMPO EM ANDAMENTO" : "CRONÔMETRO"}</span><output className="timer-clock" aria-label="Tempo decorrido" aria-live="off">{elapsedLabel(seconds)}</output><button className={`button timer-button ${timer ? "danger" : "primary"}`} disabled={busy || !ready || (!timer && !project)}>{busy ? <Loader2 size={19} className="spin"/> : timer ? <Square size={17} fill="currentColor"/> : <Play size={18} fill="currentColor"/>}{busy ? "Salvando..." : timer ? "STOP" : "START"}</button><p>{timer ? "Ao parar, suas horas são salvas automaticamente." : "Tudo pronto? Dê START e foque no trabalho."}</p></div>
      {!active.length && !timer && !project && <div className="timer-empty-note">Você precisa de um projeto ativo para começar. <button type="button" className="text-link" onClick={onNewProject}>Criar projeto</button></div>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {needsRefresh && <button type="button" className="button" onClick={async () => { try { await onSaved(); setNeedsRefresh(false); setError(""); } catch { setError("Não foi possível atualizar os registros. Tente novamente."); } }}>Atualizar registros</button>}
    </form><div className="timer-footer"><Clock3 size={14}/><span>O timer continua ao sair desta página. Duração salva em minutos, arredondada para cima.</span></div>
  </section>;
}
