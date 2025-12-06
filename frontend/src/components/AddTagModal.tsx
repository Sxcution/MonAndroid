import React, { useState } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { X } from 'lucide-react';

interface AddTagModalProps {
    onClose: () => void;
}

export const AddTagModal: React.FC<AddTagModalProps> = ({ onClose }) => {
    const [tagName, setTagName] = useState('');
    const { addTag } = useAppStore();

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = tagName.trim();
        if (trimmed) {
            addTag(trimmed);
            onClose();
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="w-full max-w-sm bg-gray-900 border border-gray-700 rounded-lg shadow-2xl p-6 relative">
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors"
                >
                    <X size={20} />
                </button>

                <h3 className="text-lg font-semibold text-white mb-4">Thêm thẻ mới</h3>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm text-gray-400 mb-1">Tên thẻ</label>
                        <input
                            type="text"
                            value={tagName}
                            onChange={(e) => setTagName(e.target.value)}
                            placeholder="Ví dụ: Wechat, Zalo..."
                            className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500 transition-colors"
                            autoFocus
                        />
                    </div>

                    <div className="flex justify-end pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 mr-2 text-sm text-gray-300 hover:text-white transition-colors"
                        >
                            Hủy
                        </button>
                        <button
                            type="submit"
                            disabled={!tagName.trim()}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded transition-colors"
                        >
                            Thêm
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
