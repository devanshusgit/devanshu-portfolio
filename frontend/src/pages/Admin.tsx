import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { api, errorMessage } from "@/api/client";
import type { SystemSettings } from "@/api/types";
import { Badge, Button, ErrorState, Field, Input, KeyValue, LoadingBlock, Notice, Panel, Stat, StatusPill, Toggle } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { dateTime, pct } from "@/lib/format";

export default function Admin() {
  const qc = useQueryClient();
  const me = useAuth((s) => s.user);
  const stats = useQuery({ queryKey: ["admin-stats"], queryFn: api.adminStats, refetchInterval: 15000 });
  const users = useQuery({ queryKey: ["admin-users"], queryFn: api.adminUsers });
  const system = useQuery({ queryKey: ["system-settings"], queryFn: api.systemSettings });
  const [draft, setDraft] = useState<SystemSettings | null>(null);
  useEffect(() => {
    if (system.data) setDraft(system.data);
  }, [system.data]);

  const updateUser = useMutation({
    mutationFn: ({ id, body }: { id: number; body: { role?: string; is_active?: boolean } }) => api.adminUpdateUser(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users"] }),
  });
  const saveSystem = useMutation({
    mutationFn: (s: SystemSettings) => api.saveSystemSettings(s),
    onSuccess: (s) => {
      qc.setQueryData(["system-settings"], s);
      qc.invalidateQueries({ queryKey: ["public-settings"] });
    },
  });

  const s = stats.data;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold tracking-tight">
          <ShieldCheck className="h-6 w-6 text-accent" /> Administration
        </h1>
        <p className="text-sm text-muted">System-wide statistics, user roles and platform settings (ADMIN role only).</p>
      </div>
      {stats.isLoading && <LoadingBlock />}
      {stats.isError && <ErrorState error={stats.error} onRetry={() => stats.refetch()} />}
      {s && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
          <Stat label="Users" value={s.users.total} sub={`${s.users.active} active · ${s.users.by_role.ADMIN ?? 0} admin`} />
          <Stat label="Predictions" value={s.predictions.total} sub={Object.entries(s.predictions.by_source).map(([k, v]) => `${k.slice(0, 3)} ${v}`).join(" · ") || "none"} />
          <Stat label="Labelled accuracy" value={pct(s.predictions.labeled_accuracy)} sub={`${s.predictions.labeled} labelled`} />
          <Stat label="Datasets" value={s.datasets.total} sub={`${s.datasets.rows} rows stored`} />
          <Stat label="Model accuracy" value={pct(s.model.accuracy)} sub={`${s.model.training_runs} training runs`} tone="accent" />
          <Stat label="Live channel" value={s.live.connected ? "LIVE" : "idle"} mono={false} sub={`${s.live.samples_received} samples · ${s.live.subscribers} subscribers`} />
        </div>
      )}
      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <Panel title="Users" icon={<Users className="h-4 w-4" />}>
          {users.isLoading && <LoadingBlock />}
          {users.isError && <ErrorState error={users.error} />}
          {updateUser.isError && <ErrorState className="mb-3" error={new Error(errorMessage(updateUser.error))} />}
          {users.data && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-[12.5px]">
                <thead className="text-left text-[10.5px] uppercase tracking-wider text-muted">
                  <tr>
                    <th className="py-2">User</th>
                    <th className="py-2">Role</th>
                    <th className="py-2">Status</th>
                    <th className="py-2 text-right">Predictions</th>
                    <th className="py-2">Last login</th>
                    <th className="py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.data.users.map((u) => {
                    const self = u.id === me?.id;
                    return (
                      <tr key={u.id} className="border-t border-line">
                        <td className="py-2">
                          <div className="font-medium">{u.full_name || "—"}</div>
                          <div className="text-xs text-muted">{u.email}</div>
                        </td>
                        <td className="py-2">
                          <Badge tone={u.role === "ADMIN" ? "violet" : "neutral"}>{u.role}</Badge>
                        </td>
                        <td className="py-2">
                          <StatusPill status={u.is_active ? "NOMINAL" : "WARNING"} /> <span className="text-xs text-muted">{u.is_active ? "active" : "deactivated"}</span>
                        </td>
                        <td className="py-2 text-right font-mono">{u.predictions}</td>
                        <td className="py-2 text-xs text-muted">{dateTime(u.last_login_at)}</td>
                        <td className="whitespace-nowrap py-2 text-right">
                          <Button size="sm" variant="ghost" disabled={self} onClick={() => updateUser.mutate({ id: u.id, body: { role: u.role === "ADMIN" ? "USER" : "ADMIN" } })}>
                            {u.role === "ADMIN" ? "Make user" : "Make admin"}
                          </Button>
                          <Button size="sm" variant={u.is_active ? "danger" : "secondary"} disabled={self} onClick={() => updateUser.mutate({ id: u.id, body: { is_active: !u.is_active } })}>
                            {u.is_active ? "Deactivate" : "Activate"}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        <div className="space-y-4">
          <Panel title="Platform settings">
            {!draft ? (
              <LoadingBlock />
            ) : (
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  saveSystem.mutate(draft);
                }}
              >
                <Toggle checked={draft.allow_registration} onChange={(v) => setDraft({ ...draft, allow_registration: v })} label="Allow self-registration" />
                <Field label="Simulated live stream default rate (Hz)" htmlFor="rate">
                  <Input id="rate" type="number" min={0.5} max={20} step={0.5} value={draft.live_stream_rate_hz} onChange={(e) => setDraft({ ...draft, live_stream_rate_hz: Number(e.target.value) })} />
                </Field>
                <Field label="Upload size limit (MB, ≤ server hard limit)" htmlFor="mb">
                  <Input id="mb" type="number" min={0.1} max={50} step={0.5} value={draft.max_upload_mb} onChange={(e) => setDraft({ ...draft, max_upload_mb: Number(e.target.value) })} />
                </Field>
                <Field label="Announcement banner" htmlFor="ann" hint="Shown to all signed-in users. Leave empty to hide.">
                  <Input id="ann" maxLength={280} value={draft.announcement} onChange={(e) => setDraft({ ...draft, announcement: e.target.value })} />
                </Field>
                <Button type="submit" variant="primary" loading={saveSystem.isPending}>
                  Save settings
                </Button>
                {saveSystem.isSuccess && <Notice tone="good">Settings saved.</Notice>}
                {saveSystem.isError && <ErrorState error={new Error(errorMessage(saveSystem.error))} />}
              </form>
            )}
          </Panel>
          {s && (
            <Panel title="Runtime">
              <KeyValue
                items={[
                  ["Environment", s.system.environment],
                  ["Database", s.system.database],
                  ["Uptime", `${(s.system.uptime_s / 3600).toFixed(2)} h`],
                  ["Model", s.model.version ?? "—"],
                  ["Training", s.model.training ? "in progress" : "idle"],
                  ["Live source", s.live.last_source ?? "—"],
                ]}
              />
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
