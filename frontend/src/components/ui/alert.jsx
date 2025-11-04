import React from 'react';

export const Alert = ({ 
  children, 
  variant = 'default', 
  className = '', 
  ...props 
}) => {
  const baseClasses = 'relative w-full rounded-lg border p-4';
  
  const variants = {
    default: 'bg-white border-gray-200',
    destructive: 'border-red-500 bg-red-50 text-red-900',
    success: 'border-green-500 bg-green-50 text-green-900'
  };
  
  const variantClasses = variants[variant] || variants.default;
  
  return (
    <div 
      className={`${baseClasses} ${variantClasses} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
};

export const AlertDescription = ({ 
  children, 
  className = '', 
  ...props 
}) => {
  return (
    <div 
      className={`text-sm ${className}`}
      {...props}
    >
      {children}
    </div>
  );
};