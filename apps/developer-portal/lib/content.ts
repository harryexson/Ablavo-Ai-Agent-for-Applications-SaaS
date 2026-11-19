"use client";
import { useApi } from "./api";

/** Registered UI elements and action keys, used by the builders' pickers. */
export function useBuilderRefs(appId: string) {
  const manifests = useApi<{ data: { content: { uiElements?: { id: string; label: string }[] } }[]; current: { content: { uiElements?: { id: string; label: string }[] } } | null }>(`/v1/applications/${appId}/manifests`);
  const actions = useApi<{ data: { key: string }[] }>(`/v1/applications/${appId}/actions`);
  const elements = (manifests.data?.current ?? manifests.data?.data[0])?.content.uiElements ?? [];
  return { elements, actionKeys: actions.data?.data.map((a) => a.key) ?? [] };
}
