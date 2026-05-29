import BackfillCard from "./BackfillCard";

interface BackfillPromptProps {
  onContinue: () => void;
}

export default function BackfillPrompt({ onContinue }: BackfillPromptProps) {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-4">
      <h1 className="text-lg font-semibold">You're connected!</h1>
      <p className="text-sm text-gray-400 mt-2">
        Bootstrap suggestions from your past orders, or skip and run this later from Settings.
      </p>

      <div className="mt-6">
        <BackfillCard />
      </div>

      <button
        onClick={onContinue}
        className="w-full mt-4 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500"
      >
        Continue
      </button>
    </div>
  );
}
