import React from 'react';

export const Badge = ({ 
  children, 
  variant = 'default', 
  className = '', 
  ...props 
}) => {
  const baseClasses = 'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium';
  
  const variants = {
    default: 'bg-blue-100 text-blue-800',
    secondary: 'bg-gray-100 text-gray-800',
    destructive: 'bg-red-100 text-red-800',
    outline: 'border border-gray-300 text-gray-700'
  };
  
  const variantClasses = variants[variant] || variants.default;
  
  return (
    <span 
      className={`${baseClasses} ${variantClasses} ${className}`}
      {...props}
    >
      {children}
    </span>
  );
};