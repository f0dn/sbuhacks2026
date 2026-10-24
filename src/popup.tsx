import { useState } from "react";
import { createRoot } from "react-dom/client";

const Popup = () => {
  const [count, setCount] = useState(0);

  return (
    <div className="flex flex-col items-center justify-center h-full p-6 text-center">
      <h1 className="text-2xl font-bold text-indigo-600 mb-2">Hello World!</h1>
      <p className="text-gray-600 mb-6 text-sm">
        React + Tailwind + Parcel + pnpm
      </p>

      <button
        onClick={() => setCount(count + 1)}
        className="px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white font-medium rounded-lg shadow transition-colors"
      >
        Clicks: {count}
      </button>
    </div>
  );
};

const container = document.getElementById("root");
const root = createRoot(container!);
root.render(<Popup />);
