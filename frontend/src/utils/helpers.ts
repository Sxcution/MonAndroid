import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Utility function to merge Tailwind CSS classes
 */
export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

/**
 * Generate a unique ID
 */
export function generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Format timestamp to readable date
 */
export function formatTimestamp(timestamp: number): string {
    return new Date(timestamp).toLocaleString();
}

/**
 * Format battery percentage
 */
export function formatBattery(battery: number): string {
    return `${battery}%`;
}

/**
 * Get battery color based on level
 */
export function getBatteryColor(battery: number): string {
    if (battery > 60) return 'text-green-500';
    if (battery > 20) return 'text-yellow-500';
    return 'text-red-500';
}

/**
 * Get status color
 */
export function getStatusColor(status: 'online' | 'offline'): string {
    return status === 'online' ? 'text-green-500' : 'text-gray-400';
}

/**
 * Delay utility
 */
export function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
