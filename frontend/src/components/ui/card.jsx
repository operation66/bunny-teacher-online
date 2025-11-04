import React from 'react';

export const Card = ({ children, className = '', gradient = false, ...props }) => {
  const baseClasses = gradient 
    ? "bg-gradient-to-br from-blue-50 via-white to-purple-50 border-0 shadow-2xl hover:shadow-3xl transform hover:-translate-y-1 transition-all duration-300 ease-out rounded-xl"
    : "bg-white border border-gray-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 transition-all duration-200 ease-out rounded-xl";
    
  return (
    <div 
      className={`${baseClasses} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
};

export const CardHeader = ({ children, className = '', gradient = false, ...props }) => {
  const baseClasses = gradient
    ? "px-6 py-5 border-b border-gray-100"
    : "px-6 py-5 border-b border-gray-200";
    
  return (
    <div 
      className={`${baseClasses} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
};

export const CardTitle = ({ children, className = '', gradient = false, ...props }) => {
  const baseClasses = gradient
    ? "text-xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent"
    : "text-xl font-bold text-gray-900";
    
  return (
    <h3 
      className={`${baseClasses} ${className}`}
      {...props}
    >
      {children}
    </h3>
  );
};

export const CardContent = ({ children, className = '', ...props }) => {
  return (
    <div 
      className={`px-6 py-5 ${className}`}
      {...props}
    >
      {children}
    </div>
  );
};