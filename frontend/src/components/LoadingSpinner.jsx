import React from 'react';
import PropTypes from 'prop-types';

const LoadingSpinner = ({
                            size = 'md',
                            color = 'primary',
                            fullScreen = false,
                            text = '',
                            className = ''
                        }) => {
    const sizes = {
        xs: 'h-4 w-4 border-2',
        sm: 'h-6 w-6 border-2',
        md: 'h-8 w-8 border-3',
        lg: 'h-12 w-12 border-4',
        xl: 'h-16 w-16 border-4'
    };

    const colors = {
        primary: 'border-t-blue-600',
        secondary: 'border-t-gray-600',
        success: 'border-t-green-600',
        danger: 'border-t-red-600',
        warning: 'border-t-yellow-600',
        info: 'border-t-indigo-600',
        light: 'border-t-gray-300',
        dark: 'border-t-gray-800'
    };

    const spinner = (
        <div className={`flex flex-col items-center justify-center ${className}`}>
            <div className={`${sizes[size]} animate-spin rounded-full border-gray-200 ${colors[color]}`}></div>
            {text && (
                <p className={`mt-3 text-sm font-medium ${
                    color === 'light' ? 'text-gray-700' :
                        color === 'dark' ? 'text-gray-800' :
                            `text-${color}-600`
                }`}>
                    {text}
                </p>
            )}
        </div>
    );

    if (fullScreen) {
        return (
            <div className="fixed inset-0 bg-white bg-opacity-80 z-50 flex items-center justify-center">
                {spinner}
            </div>
        );
    }

    return spinner;
};

LoadingSpinner.propTypes = {
    size: PropTypes.oneOf(['xs', 'sm', 'md', 'lg', 'xl']),
    color: PropTypes.oneOf(['primary', 'secondary', 'success', 'danger', 'warning', 'info', 'light', 'dark']),
    fullScreen: PropTypes.bool,
    text: PropTypes.string,
    className: PropTypes.string
};

export default LoadingSpinner;