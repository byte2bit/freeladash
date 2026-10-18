"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { catalogModel } from "@/lib/models";
import type { Client, Project } from "@/lib/types";

export function useCatalog(resource: "clients" | "projects", enabled: boolean, initialClients: Client[], initialProjects: Project[], status:"all"|"active"="all") {
  const [clients,setClients]=useState(initialClients);
  const [projects,setProjects]=useState(initialProjects);
  const [search,setSearch]=useState("");
  const [page,setPage]=useState(1);
  const [pages,setPages]=useState(1);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const generation=useRef(0);
  const read=useCallback(async(next: number, append: boolean, version: number, signal?: AbortSignal)=>{
    setBusy(true); setError("");
    try {
      const params=new URLSearchParams({resource,q:search,page:String(next),status});
      const response=await fetch(`/api/catalog?${params}`,{signal,cache:"no-store"});
      if(!response.ok)throw new Error("Não foi possível carregar as opções.");
      const result=catalogModel.parse(await response.json());
      if(version!==generation.current || signal?.aborted)return;
      if(result.resource==='clients')setClients(previous=>append?[...previous,...result.items]:result.items);
      else setProjects(previous=>append?[...previous,...result.items]:result.items);
      setPage(result.pagination.page);setPages(result.pagination.pages);
    } catch(error) {
      if(version===generation.current && !signal?.aborted)setError(error instanceof Error?error.message:"Não foi possível carregar as opções.");
    } finally { if(version===generation.current && !signal?.aborted)setBusy(false); }
  },[resource,search,status]);
  const seed=resource==='clients'?initialClients:initialProjects;
  useEffect(()=>{
    if(!enabled)return;
    const version=++generation.current;
    const controller=new AbortController();
    const timeout=setTimeout(()=>void read(1,false,version,controller.signal),200);
    return()=>{clearTimeout(timeout);controller.abort();generation.current++;};
  },[enabled,read,seed]);
  return {clients,projects,search,setSearch,busy,error,hasMore:page<pages,loadMore:()=>void read(page+1,true,generation.current)};
}

export function CatalogControls({catalog,label}:{catalog:ReturnType<typeof useCatalog>;label:string}) {
  return <div className="catalog-controls">
    <label>Buscar {label}<input type="search" value={catalog.search} maxLength={120} onChange={event=>catalog.setSearch(event.target.value)} placeholder={`Buscar ${label} pelo nome`}/></label>
    {catalog.busy&&<small role="status">Carregando opções…</small>}
    {catalog.error&&<p className="form-error" role="alert">{catalog.error}</p>}
    {catalog.hasMore&&<button type="button" className="text-link" disabled={catalog.busy} onClick={catalog.loadMore}>Carregar mais {label}</button>}
  </div>;
}
