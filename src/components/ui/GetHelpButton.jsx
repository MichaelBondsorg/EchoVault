import React from 'react';
import { Shield } from 'lucide-react';

const GetHelpButton = ({ onClick }) => (
  <button
    onClick={onClick}
    className="p-2 rounded-full hover:bg-red-50 text-red-500 transition-colors"
    title="Get Help"
  >
    <Shield size={20} />
  </button>
);

export default GetHelpButton;
