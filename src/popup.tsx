import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ToggleSections } from './messages.js';

const Popup = () => {
  const [error, setError] = useState('');

  const toggleSections = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) return;
    const message: ToggleSections = { type: 'toggle-sections' };
    try {
      await chrome.tabs.sendMessage(tab.id, message);
      window.close();
    } catch {
      // no content script: not an https page, or it was open before install
      setError('Can’t open here. Try an https page, or reload this one.');
    }
  };

  return (
    <div className="flex flex-col gap-4 h-full p-6">
      <h1 className="text-xl font-bold text-gray-900">Section navigation</h1>
      <p className="text-gray-600 text-sm">
        Jumps between the sections of the page, including the ones Jev finds
        that the page doesn’t mark up.
      </p>

      <button
        onClick={toggleSections}
        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg shadow transition-colors"
      >
        Navigate sections
      </button>
      {error && <p className="text-red-600 text-sm">{error}</p>}

      <p className="text-gray-500 text-xs">
        On any page: <kbd className="px-1 rounded bg-gray-100">Alt</kbd>+
        <kbd className="px-1 rounded bg-gray-100">Shift</kbd>+
        <kbd className="px-1 rounded bg-gray-100">↓</kbd> /{' '}
        <kbd className="px-1 rounded bg-gray-100">↑</kbd> for the next or
        previous section. Focus moves to the section’s title, so your screen
        reader reads it and carries on from there.
      </p>
    </div>
  );
};

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<Popup />);
