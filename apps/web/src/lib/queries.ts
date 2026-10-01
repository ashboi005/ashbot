"use client";

import type {
  AdminTicketDetail,
  AdminTicketSummary,
  AttachmentDto,
  ClientDto,
  InviteDto,
  InvitePreview,
  Me,
  ProjectDto,
  TicketDetail,
  TicketStatus,
  TicketSummary,
} from "@ashbot/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "./api";

const POLL_MS = 4000;

export const keys = {
  me: ["me"] as const,
  tickets: (projectId?: string) => ["tickets", projectId ?? "all"] as const,
  ticket: (id: string) => ["ticket", id] as const,
  adminTickets: (status?: TicketStatus) => ["admin", "tickets", status ?? "all"] as const,
  adminTicket: (id: string) => ["admin", "ticket", id] as const,
  projects: ["admin", "projects"] as const,
  clients: ["admin", "clients"] as const,
  invites: ["admin", "invites"] as const,
};

export function useMe() {
  return useQuery({ queryKey: keys.me, queryFn: () => api<Me>("/api/me"), retry: false, staleTime: 60_000 });
}

// ---- Client ----

export function useTickets(projectId: string | undefined) {
  return useQuery({
    queryKey: keys.tickets(projectId),
    queryFn: () => api<TicketSummary[]>(`/api/tickets${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`),
    enabled: Boolean(projectId),
    refetchInterval: POLL_MS * 3,
  });
}

export function useTicket(id: string | undefined) {
  return useQuery({
    queryKey: keys.ticket(id ?? ""),
    queryFn: () => api<TicketDetail>(`/api/tickets/${id}`),
    enabled: Boolean(id),
    refetchInterval: POLL_MS,
  });
}

export function useUpload() {
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return api<AttachmentDto>("/api/uploads", { method: "POST", body: form });
    },
  });
}

export function useCreateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { projectId: string; body: string; attachmentIds: string[] }) => api<TicketDetail>("/api/tickets", { method: "POST", json: input }),
    onSuccess: (ticket) => {
      qc.setQueryData(keys.ticket(ticket.id), ticket);
      qc.invalidateQueries({ queryKey: ["tickets"] });
    },
  });
}

export function useSendMessage(ticketId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { body: string; attachmentIds: string[] }) => api<TicketDetail>(`/api/tickets/${ticketId}/messages`, { method: "POST", json: input }),
    onSuccess: (ticket) => {
      qc.setQueryData(keys.ticket(ticket.id), ticket);
      qc.invalidateQueries({ queryKey: ["tickets"] });
    },
  });
}

// ---- Invites ----

export function useInvitePreview(token: string) {
  return useQuery({ queryKey: ["invite", token], queryFn: () => api<InvitePreview>(`/api/invites/${token}`), retry: false });
}

// ---- Admin ----

export function useAdminTickets(status?: TicketStatus) {
  return useQuery({
    queryKey: keys.adminTickets(status),
    queryFn: () => api<AdminTicketSummary[]>(`/api/admin/tickets${status ? `?status=${status}` : ""}`),
    refetchInterval: POLL_MS * 2,
  });
}

export function useAdminTicket(id: string) {
  return useQuery({ queryKey: keys.adminTicket(id), queryFn: () => api<AdminTicketDetail>(`/api/admin/tickets/${id}`), refetchInterval: POLL_MS });
}

function useAdminTicketMutation<TInput>(id: string, run: (input: TInput) => Promise<AdminTicketDetail>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: (ticket) => {
      qc.setQueryData(keys.adminTicket(id), ticket);
      qc.invalidateQueries({ queryKey: ["admin", "tickets"] });
    },
  });
}

export function useAdminReply(id: string) {
  return useAdminTicketMutation(id, (body: string) => api<AdminTicketDetail>(`/api/admin/tickets/${id}/messages`, { method: "POST", json: { body } }));
}

export function useSetStatus(id: string) {
  return useAdminTicketMutation(id, (status: TicketStatus) => api<AdminTicketDetail>(`/api/admin/tickets/${id}`, { method: "PATCH", json: { status } }));
}

export function useRerun(id: string) {
  return useAdminTicketMutation(id, () => api<AdminTicketDetail>(`/api/admin/tickets/${id}/investigations`, { method: "POST" }));
}

export function useProjects() {
  return useQuery({ queryKey: keys.projects, queryFn: () => api<ProjectDto[]>("/api/admin/projects") });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { slug: string; name: string }) => api<ProjectDto>("/api/admin/projects", { method: "POST", json: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.projects }),
  });
}

export function useUpdateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string; name?: string; runbook?: string }) => api<ProjectDto>(`/api/admin/projects/${id}`, { method: "PATCH", json: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.projects }),
  });
}

export function useClients() {
  return useQuery({ queryKey: keys.clients, queryFn: () => api<ClientDto[]>("/api/admin/clients") });
}

export function useSetClientProjects() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, projectIds }: { id: string; projectIds: string[] }) => api<ClientDto>(`/api/admin/clients/${id}/projects`, { method: "PUT", json: { projectIds } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.clients });
      qc.invalidateQueries({ queryKey: keys.projects });
    },
  });
}

export function useInvites() {
  return useQuery({ queryKey: keys.invites, queryFn: () => api<InviteDto[]>("/api/admin/invites") });
}

export function useCreateInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; name: string; projectIds: string[] }) => api<InviteDto>("/api/admin/invites", { method: "POST", json: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.invites }),
  });
}

export function useRevokeInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<{ ok: true }>(`/api/admin/invites/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.invites }),
  });
}
