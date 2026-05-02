export default function NotAvailablePage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-white dark:bg-neutral-950">
      <div className="text-center px-6">
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-white mb-3">
          Service Not Available
        </h1>
        <p className="text-neutral-500 dark:text-neutral-400">
          IgualAI is not available in your region.
        </p>
      </div>
    </div>
  )
}
