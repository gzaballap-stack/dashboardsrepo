"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function DashboardError({ error }: { error: Error }) {
  const router = useRouter();

  useEffect(() => {
    console.error("Dashboard error:", error);
    // Any client-side crash here → fall back to login
    router.replace("/login");
  }, [error, router]);

  return null;
}
