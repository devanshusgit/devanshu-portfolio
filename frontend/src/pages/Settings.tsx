import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound, SlidersHorizontal, UserRound } from "lucide-react";
import { useState } from "react";
import { api, errorMessage } from "@/api/client";
import type { UserSettings } from "@/api/types";
import { Button, ErrorState, Field, Input, Notice, Panel, Segmented, Select, Toggle } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useCatalog } from "@/lib/catalog";
import { usePrefs } from "@/lib/prefs";

export default function SettingsPage() {
  const qc = useQueryClient();
  const prefs = usePrefs();
  const user = useAuth((s) => s.user);
  const setUser = useAuth((s) => s.setUser);
  const catalog = useCatalog();
  const [name, setName] = useState(user?.full_name ?? "");
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [pwError, setPwError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (patch: Partial<UserSettings>) => api.saveSettings(patch),
    onSuccess: (r) => {
      prefs.hydrate(r.user);
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
  });
  const update = (patch: Partial<UserSettings>) => {
    prefs.set(patch); // optimistic
    save.mutate(patch);
  };
  const profile = useMutation({ mutationFn: () => api.updateProfile(name), onSuccess: setUser });
  const password = useMutation({
    mutationFn: () => api.changePassword(pw.current, pw.next),
    onSuccess: () => setPw({ current: "", next: "", confirm: "" }),
  });

  return (
    <div className="max-w-4xl space-y-4">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted">Preferences are stored server-side on your account.</p>
      </div>
      <Panel title="Simulation & display" icon={<SlidersHorizontal className="h-4 w-4" />} actions={save.isPending ? <span className="text-xs text-muted">saving…</span> : save.isSuccess ? <span className="text-xs text-good">saved</span> : null}>
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">Theme</div>
              <p className="text-xs text-muted">Dark is optimised for the 3D lab.</p>
            </div>
            <Segmented label="Theme" value={prefs.theme} onChange={(v) => update({ theme: v })} options={[{ value: "dark", label: "Dark" }, { value: "light", label: "Light" }, { value: "system", label: "System" }]} />
          </div>
          <Toggle checked={prefs.reduced_motion} onChange={(v) => update({ reduced_motion: v })} label="Reduce motion" description="Shortens 3D animations and disables decorative effects (the OS setting is also respected)." />
          <Toggle checked={prefs.show_sensor_labels} onChange={(v) => update({ show_sensor_labels: v })} label="Show tactile sensor labels in 3D" />
          <Toggle checked={prefs.auto_save_history} onChange={(v) => update({ auto_save_history: v })} label="Save simulations to history by default" />
          <Toggle checked={prefs.record_playback} onChange={(v) => update({ record_playback: v })} label="Record dataset playback rows in history" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Default object in the lab" htmlFor="defobj">
              <Select id="defobj" value={prefs.default_object} onChange={(e) => update({ default_object: e.target.value })}>
                {catalog.objects.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Default playback speed" htmlFor="speed">
              <Select id="speed" value={String(prefs.playback_speed)} onChange={(e) => update({ playback_speed: Number(e.target.value) })}>
                {[0.5, 1, 2, 5].map((s) => (
                  <option key={s} value={s}>
                    {s}x
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {save.isError && <ErrorState error={new Error(errorMessage(save.error))} title="Could not save settings" />}
        </div>
      </Panel>
      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Profile" icon={<UserRound className="h-4 w-4" />}>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              profile.mutate();
            }}
          >
            <Field label="Email">
              <Input value={user?.email ?? ""} disabled />
            </Field>
            <Field label="Full name" htmlFor="fn">
              <Input id="fn" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
            </Field>
            <div className="flex items-center gap-3">
              <Button type="submit" loading={profile.isPending}>
                Save profile
              </Button>
              <span className="font-mono text-xs text-muted">role: {user?.role}</span>
            </div>
            {profile.isSuccess && <Notice tone="good">Profile updated.</Notice>}
            {profile.isError && <ErrorState error={new Error(errorMessage(profile.error))} />}
          </form>
        </Panel>
        <Panel title="Change password" icon={<KeyRound className="h-4 w-4" />}>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (pw.next.length < 8) return setPwError("New password must be at least 8 characters.");
              if (pw.next !== pw.confirm) return setPwError("Passwords do not match.");
              setPwError(null);
              password.mutate();
            }}
          >
            <Field label="Current password" htmlFor="cpw">
              <Input id="cpw" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
            </Field>
            <Field label="New password" htmlFor="npw">
              <Input id="npw" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
            </Field>
            <Field label="Confirm new password" htmlFor="cnpw" error={pwError}>
              <Input id="cnpw" type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
            </Field>
            <Button type="submit" loading={password.isPending} disabled={!pw.current || !pw.next}>
              Update password
            </Button>
            {password.isSuccess && <Notice tone="good">Password changed.</Notice>}
            {password.isError && <ErrorState error={new Error(errorMessage(password.error))} />}
          </form>
        </Panel>
      </div>
    </div>
  );
}
