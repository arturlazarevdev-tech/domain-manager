"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, Input } from "@/components/ui/primitives";
import { Field } from "@/components/ui/dialog";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md p-8">
        <div className="mb-6 flex items-center gap-2">
          <Globe className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">Domain Manager</h1>
        </div>
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setLoading(true);
            setError("");
            const res = await fetch("/api/auth/login", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email, password }),
            });
            setLoading(false);
            if (!res.ok) {
              const data = await res.json();
              setError(data.error?.message || "Login failed");
              return;
            }
            router.push("/");
          }}
        >
          <Field label="Login (email)">
            <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="username" />
          </Field>
          <Field label="Password">
            <Input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" />
          </Field>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button size="lg" disabled={loading}>
            {loading ? "Signing in..." : "Sign in"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
