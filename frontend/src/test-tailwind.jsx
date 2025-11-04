import React from 'react';

const TestTailwind = () => {
  return (
    <div className="p-8 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-lg shadow-xl">
      <h1 className="text-4xl font-bold mb-4">Tailwind CSS Test</h1>
      <p className="text-lg">If you can see this with gradient background and styling, Tailwind is working!</p>
      <div className="mt-4 p-4 bg-white/20 backdrop-blur-sm rounded-lg">
        <p className="text-sm">This should have a glass morphism effect</p>
      </div>
    </div>
  );
};

export default TestTailwind;