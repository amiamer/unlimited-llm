'use client';

import React, { useRef, useState } from 'react';

/**
 * UploadButton - Handles ePub file upload to S3
 * Requirements: 1.1, 1.2, 1.5
 * 
 * This component provides a file selection interface, validates ePub file format,
 * uploads to local storage via BOOKS_PATH, and returns serving URL
 */

interface UploadButtonProps {
  onUploadComplete: (url: string, fileName: string) => void;
  onUploadError: (error: string) => void;
  disabled: boolean;
}

export function UploadButton({
  onUploadComplete,
  onUploadError,
  disabled,
}: UploadButtonProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const handleButtonClick = () => {
    if (!disabled && !isUploading) {
      fileInputRef.current?.click();
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    
    if (!file) {
      return;
    }

    // Validate file extension is .epub
    if (!file.name.toLowerCase().endsWith('.epub')) {
      onUploadError('Invalid file format. Only .epub files are supported.');
      // Reset input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      return;
    }

    // Start upload
    setIsUploading(true);
    setUploadProgress(0);

    try {
      // Create form data
      const formData = new FormData();
      formData.append('file', file);

      // Simulate progress (since we don't have real progress from fetch)
      const progressInterval = setInterval(() => {
        setUploadProgress((prev) => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return 90;
          }
          return prev + 10;
        });
      }, 200);

      // Upload to S3 via API
      const response = await fetch('/api/reader/upload', {
        method: 'POST',
        body: formData,
      });

      clearInterval(progressInterval);

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to upload file');
      }

      // Complete progress
      setUploadProgress(100);

      // Notify parent of successful upload
      onUploadComplete(data.url || data.filePath || data.localPath, data.fileName);

      // Reset state after a brief delay to show 100%
      setTimeout(() => {
        setIsUploading(false);
        setUploadProgress(0);
        // Reset input
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }, 500);

    } catch (error) {
      console.error('Upload error:', error);
      onUploadError(error instanceof Error ? error.message : 'Failed to upload file');
      
      // Reset state
      setIsUploading(false);
      setUploadProgress(0);
      
      // Reset input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <div className="upload-button-container">
      <input
        ref={fileInputRef}
        type="file"
        accept=".epub"
        onChange={handleFileChange}
        style={{ display: 'none' }}
        aria-label="Select ePub file"
      />
      
      <button
        onClick={handleButtonClick}
        disabled={disabled || isUploading}
        className="upload-button"
        aria-label="Upload ePub file"
      >
        {isUploading ? (
          <>
            <SpinnerIcon />
            <span>Uploading...</span>
          </>
        ) : (
          <>
            <UploadIcon />
            <span>Upload ePub File</span>
          </>
        )}
      </button>

      {isUploading && (
        <div className="progress-container" role="progressbar" aria-valuenow={uploadProgress} aria-valuemin={0} aria-valuemax={100}>
          <div className="progress-bar" style={{ width: `${uploadProgress}%` }} />
          <span className="progress-text">{uploadProgress}%</span>
        </div>
      )}

      <style jsx>{`
        .upload-button-container {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .upload-button {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.75rem;
          padding: 1rem 2rem;
          border: none;
          border-radius: 0.5rem;
          font-size: 1rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
          background: #b83030;
          color: white;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }

        .upload-button:hover:not(:disabled) {
          background: #d84848;
          transform: translateY(-2px);
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
        }

        .upload-button:active:not(:disabled) {
          transform: translateY(0);
        }

        .upload-button:disabled {
          background: #d1d5db;
          color: #9ca3af;
          cursor: not-allowed;
          opacity: 0.6;
        }

        .progress-container {
          position: relative;
          width: 100%;
          height: 2rem;
          background: #e5e7eb;
          border-radius: 0.375rem;
          overflow: hidden;
        }

        .progress-bar {
          height: 100%;
          background: linear-gradient(90deg, #b83030, #d84848);
          transition: width 0.3s ease;
          border-radius: 0.375rem;
        }

        .progress-text {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          font-size: 0.875rem;
          font-weight: 600;
          color: #1f2937;
        }
      `}</style>
    </div>
  );
}

// Icon components
function UploadIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="spinner"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray="32"
        strokeDashoffset="32"
      >
        <animate
          attributeName="stroke-dashoffset"
          values="32;0"
          dur="1s"
          repeatCount="indefinite"
        />
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 12 12"
          to="360 12 12"
          dur="1s"
          repeatCount="indefinite"
        />
      </circle>
    </svg>
  );
}
