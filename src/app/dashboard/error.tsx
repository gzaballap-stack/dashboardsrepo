"use client";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-[#0c1828] text-black">
      <div className="text-4xl">⚠️</div>
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-sm text-gray-400 max-w-sm text-center">
        {error?.message ?? "An unexpected error occurred loading the dashboard."}
      </p>
      <div className="flex gap-3 mt-2">
        <button
          onClick={reset}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm font-medium"
        >
          Try again
        </button>
        <a
          href="/api/auth/clear"
          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm font-medium"
        >
          Clear session &amp; log in
        </a>
      </div>
    </div>
  );
}
