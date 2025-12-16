'use client'

import { useState, useEffect, useRef } from 'react'
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { getFullnodeUrl } from '@mysten/sui/client'
import { walrus, WalrusFile } from '@mysten/walrus'

export default function Home() {
  const [isEncoding, setIsEncoding] = useState(false)
  const [counter, setCounter] = useState(0)
  const [inputValue, setInputValue] = useState('')
  const [ballPosition, setBallPosition] = useState(0)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [fileName, setFileName] = useState('Screen Recording 2025-10-06 at 17.21.59.gif')
  const [defaultFileData, setDefaultFileData] = useState<Uint8Array | null>(null)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const animationRef = useRef<NodeJS.Timeout | null>(null)

  // Initialize Walrus client - let it auto-detect WASM
  const walrusClient = new SuiJsonRpcClient({
    url: getFullnodeUrl('testnet'),
    network: 'testnet',
  }).$extend(walrus())

  // Handle file selection
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      setSelectedFile(file)
      setFileName(file.name)
    }
  }

  // Load default file if no file is selected
  const loadDefaultFile = async (): Promise<Uint8Array> => {
    try {
      const response = await fetch('/Screen%20Recording%202025-10-06%20at%2017.21.59.gif')
      const arrayBuffer = await response.arrayBuffer()
      return new Uint8Array(arrayBuffer)
    } catch (error) {
      console.error('Failed to load default file:', error)
      // Fallback to a smaller test file if default fails
      const fallbackData = new Uint8Array(1024 * 1024 * 50) // 50MB fallback
      for (let i = 0; i < fallbackData.length; i++) {
        fallbackData[i] = Math.floor(Math.random() * 256)
      }
      return fallbackData
    }
  }

  // Preload default file on component mount
  useEffect(() => {
    const preloadDefaultFile = async () => {
      try {
        const fileData = await loadDefaultFile()
        setDefaultFileData(fileData)
      } catch (error) {
        console.error('Failed to preload default file:', error)
      }
    }

    preloadDefaultFile()
  }, [])

  const startEncoding = async () => {
    setIsEncoding(true)

    try {
      let fileData: Uint8Array

      if (selectedFile) {
        // Use selected file
        fileData = new Uint8Array(await selectedFile.arrayBuffer())
      } else {
        // Use preloaded default file
        if (defaultFileData) {
          fileData = defaultFileData
        } else {
          // Fallback: load file on demand if preload failed
          fileData = await loadDefaultFile()
        }
      }

      // Create Walrus flow - this is the actual blocking operation
      const flow = walrusClient.walrus.writeFilesFlow({
        files: [
          WalrusFile.from({
            contents: fileData,
            identifier: selectedFile ? selectedFile.name : 'demo-file.bin',
          }),
        ],
      })

      // This encode() call will block the main thread for several seconds
      await flow.encode()

      setIsEncoding(false)
    } catch (error) {
      console.error('Encoding failed:', error)
      // Reset state on error
      if (intervalRef.current) clearInterval(intervalRef.current)
      setIsEncoding(false)
    }
  }

  const clearAllIntervals = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
    }
    if (animationRef.current) {
      clearInterval(animationRef.current)
    }
  }

  useEffect(() => {
    return () => {
      clearAllIntervals()
    }
  }, [])

  // Ball animation
  useEffect(() => {
    if (!isEncoding) {
      animationRef.current = setInterval(() => {
        setBallPosition((prev) => (prev + 3) % 360)
      }, 15)
    } else {
      if (animationRef.current) {
        clearInterval(animationRef.current)
      }
    }

    return () => {
      if (animationRef.current) {
        clearInterval(animationRef.current)
      }
    }
  }, [isEncoding])

  return (
    <div className='min-h-screen bg-white py-4 px-4'>
      <div className='max-w-7xl mx-auto'>
        {/* Header */}
        <div className='text-center mb-8'>
          <h1 className='text-5xl font-semibold text-gray-900 mb-4 tracking-tight'>Walrus Upload Encoding</h1>
          <p className='text-lg text-gray-500 max-w-2xl mx-auto'>
            Demonstrating real browser main thread blocking during{' '}
            <code className='bg-gray-50 px-3 py-1 rounded-md text-sm font-mono border border-gray-200'>
              flow.encode()
            </code>
          </p>
        </div>

        {/* File Selection */}
        <div className='bg-white border border-gray-200 rounded-xl p-8 py-4 mb-8 max-w-xl mx-auto'>
          <h3 className='text-xl font-medium mb-6 text-gray-900'>Select File to Encode</h3>
          <div className='space-y-5'>
            {/* Hidden file input */}
            <input
              type='file'
              onChange={handleFileSelect}
              disabled={isEncoding}
              className='hidden'
              accept='*/*'
              id='file-input'
            />

            {/* Custom file picker button */}
            <label
              htmlFor='file-input'
              className='group relative w-full h-32 border-2 border-dashed border-gray-400 rounded-xl cursor-pointer transition-all duration-200 flex flex-col items-center justify-center hover:border-gray-600 hover:bg-gray-50 active:bg-gray-100'
            >
              <div className='flex flex-col items-center space-y-3'>
                {/* Upload icon */}
                <div className='w-12 h-12 rounded-full flex items-center justify-center transition-colors bg-linear-to-br from-gray-900 to-gray-700 group-hover:from-gray-800 group-hover:to-gray-600'>
                  <svg
                    className='w-6 h-6 text-white'
                    fill='none'
                    stroke='currentColor'
                    viewBox='0 0 24 24'
                  >
                    <path
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      strokeWidth={2}
                      d='M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12'
                    />
                  </svg>
                </div>

                {/* Text content */}
                <div className='text-center'>
                  <p className='text-base font-semibold text-gray-900'>
                    Choose File to Encode
                  </p>
                  <p className='text-sm mt-1 text-gray-500'>
                    Click to browse or drag and drop
                  </p>
                </div>
              </div>

              {/* Hover overlay effect */}
              <div className='absolute inset-0 rounded-xl transition-opacity duration-200 opacity-0 group-hover:opacity-10 bg-gray-900'></div>
            </label>

            {/* Optional note */}
            <div className='text-center'>
              <p className='text-sm text-gray-500 italic'>
                Or skip this step to use the default demo file
              </p>
            </div>

            {/* File info display */}
            <div className='bg-gray-50 border border-gray-200 rounded-lg p-4'>
              <div className='flex items-center space-x-3'>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                  selectedFile ? 'bg-green-100' : 'bg-gray-200'
                }`}>
                  <svg
                    className={`w-4 h-4 ${selectedFile ? 'text-green-600' : 'text-gray-500'}`}
                    fill='none'
                    stroke='currentColor'
                    viewBox='0 0 24 24'
                  >
                    <path
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      strokeWidth={2}
                      d='M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z'
                    />
                  </svg>
                </div>
                <div className='flex-1 min-w-0'>
                  <p className='text-sm font-medium text-gray-900 truncate'>
                    {fileName}
                  </p>
                  <p className='text-xs text-gray-500'>
                    {selectedFile && `${(selectedFile.size / (1024 * 1024)).toFixed(2)} MB`}
                  </p>
                </div>
                {selectedFile && (
                  <button
                    onClick={() => {
                      const input = document.getElementById('file-input') as HTMLInputElement;
                      if (input) input.value = '';
                      setSelectedFile(null);
                      setFileName('Screen Recording 2025-10-06 at 17.21.59.gif');
                    }}
                    disabled={isEncoding}
                    className='text-gray-400 hover:text-gray-600 disabled:opacity-50 disabled:cursor-not-allowed'
                    title='Clear selection'
                  >
                    <svg className='w-4 h-4' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                      <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M6 18L18 6M6 6l12 12' />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Main Action Button */}
        <div className='text-center mb-8'>
          <button
            onClick={() => startEncoding()}
            disabled={isEncoding}
            className='px-10 py-4 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors font-medium text-base disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-gray-900'
          >
            {isEncoding ? (
              <span className='inline-flex items-center gap-2.5'>
                <svg className='w-4 h-4 animate-spin' fill='none' viewBox='0 0 24 24'>
                  <circle className='opacity-25' cx='12' cy='12' r='10' stroke='currentColor' strokeWidth='4'></circle>
                  <path
                    className='opacity-75'
                    fill='currentColor'
                    d='M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z'
                  ></path>
                </svg>
                Encoding in Progress
              </span>
            ) : (
              'Start Encoding'
            )}
          </button>
        </div>

        {/* Demo Content */}
        <div className='grid lg:grid-cols-3 gap-4'>
          {/* COLUMN 1: Main Thread - Interactive Elements */}
          <div className='space-y-6'>
            {/* Interactive Counter */}
            <div className='bg-white border border-gray-200 rounded-xl p-6 transition-colors'>
              <div className='flex items-center justify-between mb-5'>
                <h3 className='text-base font-medium text-gray-900'>
                  Interactive Counter
                </h3>
                <span
                  className={`text-xs px-2.5 py-1 rounded-full border ${
                    isEncoding ? 'bg-gray-100 text-gray-600 border-gray-200' : 'bg-white text-gray-700 border-gray-300'
                  }`}
                >
                  {isEncoding ? 'Paused' : 'Active'}
                </span>
              </div>
              <div className='flex items-center justify-center gap-5 py-4'>
                <button
                  onClick={() => setCounter((prev) => prev - 1)}
                  className='px-5 py-2.5 rounded-lg font-medium text-sm transition-colors bg-gray-900 text-white hover:bg-gray-800'
                >
                  Decrease
                </button>
                <div className='text-center min-w-[80px]'>
                  <div className='text-4xl font-semibold tabular-nums text-gray-900'>
                    {counter}
                  </div>
                </div>
                <button
                  onClick={() => setCounter((prev) => prev + 1)}
                  className='px-5 py-2.5 rounded-lg font-medium text-sm transition-colors bg-gray-900 text-white hover:bg-gray-800'
                >
                  Increase
                </button>
              </div>
              <p className='text-xs text-center mt-4 text-gray-400'>
                Buttons respond immediately
              </p>
            </div>

            {/* Text Input */}
            <div className='bg-white border border-gray-200 rounded-xl p-6 transition-colors'>
              <div className='flex items-center justify-between mb-5'>
                <h3 className='text-base font-medium text-gray-900'>
                  Text Input
                </h3>
                <span
                  className={`text-xs px-2.5 py-1 rounded-full border ${
                    isEncoding ? 'bg-gray-100 text-gray-600 border-gray-200' : 'bg-white text-gray-700 border-gray-300'
                  }`}
                >
                  {isEncoding ? 'Paused' : 'Active'}
                </span>
              </div>
              <input
                type='text'
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder='Type something here'
                className='w-full px-4 py-3 border border-gray-300 rounded-lg transition-colors text-sm focus:border-gray-900 focus:outline-none placeholder-gray-400'
              />
              <div className='mt-4'>
                <p className='text-sm text-gray-700'>
                  <span className='font-medium'>You typed:</span>{' '}
                  {inputValue || 'nothing yet'}
                </p>
                <p className='text-xs mt-2 text-gray-400'>
                  Text appears instantly
                </p>
              </div>
            </div>
          </div>

          {/* COLUMN 2: Main Thread - Animations */}
          <div className='space-y-6'>
            {/* JavaScript Animation */}
            <div className='bg-white border border-gray-200 rounded-xl p-6 transition-colors'>
              <div className='flex items-center justify-between mb-5'>
                <h3 className='text-base font-medium text-gray-900'>
                  JavaScript Animation
                </h3>
                <span
                  className={`text-xs px-2.5 py-1 rounded-full border ${
                    isEncoding ? 'bg-gray-100 text-gray-600 border-gray-200' : 'bg-white text-gray-700 border-gray-300'
                  }`}
                >
                  {isEncoding ? 'Paused' : 'Active'}
                </span>
              </div>
              <div className='relative h-24 rounded-lg overflow-hidden bg-gray-50'>
                <div
                  className='w-8 h-8 rounded-full bg-gray-900'
                  style={{
                    transform: `translateX(${
                      Math.sin((ballPosition * Math.PI) / 90) * 140 + 140 +
                      Math.sin((ballPosition * Math.PI) / 45) * 30
                    }px) translateY(${
                      Math.sin((ballPosition * Math.PI) / 120) * 35 + 40 +
                      Math.cos((ballPosition * Math.PI) / 60) * 15
                    }px)`,
                  }}
                ></div>
              </div>
              <p className='text-xs text-center mt-4 text-gray-400'>
                Ball moves using JavaScript
              </p>
            </div>

            {/* SVG Animation */}
            <div className='bg-white border border-gray-200 rounded-xl p-6 transition-colors'>
              <div className='flex items-center justify-between mb-5'>
                <h3 className='text-base font-medium text-gray-900'>
                  SVG Animations
                </h3>
                <span
                  className={`text-xs px-2.5 py-1 rounded-full border ${
                    isEncoding ? 'bg-gray-100 text-gray-600 border-gray-200' : 'bg-white text-gray-700 border-gray-300'
                  }`}
                >
                  {isEncoding ? 'Paused' : 'Active'}
                </span>
              </div>
              <div className='flex justify-center py-2'>
                <svg
                  width='120'
                  height='80'
                  viewBox='0 0 120 80'
                  className='border border-gray-200 rounded-lg bg-white'
                >
                  <circle cx='30' cy='40' r='8' fill='#171717' opacity='1'>
                    <animateTransform
                      attributeName='transform'
                      attributeType='XML'
                      type='rotate'
                      from='0 30 40'
                      to='360 30 40'
                      dur='2s'
                      repeatCount='indefinite'
                    />
                  </circle>
                  <rect x='50' y='35' width='12' height='12' fill='#404040' rx='2' opacity='1'>
                    <animateTransform
                      attributeName='transform'
                      attributeType='XML'
                      type='translate'
                      values='0,0; 20,0; 20,-20; 0,-20; 0,0'
                      dur='3s'
                      repeatCount='indefinite'
                    />
                  </rect>
                  <circle cx='90' cy='40' r='6' fill='#737373' opacity='1'>
                    <animate attributeName='opacity' values='1;0.3;1' dur='1.5s' repeatCount='indefinite' />
                  </circle>
                </svg>
              </div>
              <p className='text-xs text-center mt-4 text-gray-400'>
                SVG animations run smoothly
              </p>
            </div>
          </div>

          {/* COLUMN 3: Compositor Thread - Always Works */}
          <div className='space-y-6'>
            {/* Static Content */}
            <div className='bg-linear-to-br from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-xl p-6 shadow-sm'>
              <div className='flex items-center justify-between mb-5'>
                <h3 className='text-base font-semibold text-blue-900'>Static Content</h3>
                <span className='text-xs px-2.5 py-1 rounded-full border bg-blue-100 text-blue-700 border-blue-300 font-medium'>
                  Always Works
                </span>
              </div>
              <div className='space-y-5'>
                <p className='text-sm text-blue-900 leading-relaxed font-medium'>
                  This text is always readable. Even during encoding, users can still see content.
                </p>
                <div className='flex justify-center gap-6 text-3xl py-2'>
                  <span>📱</span>
                  <span>💻</span>
                  <span>🎯</span>
                </div>
                <p className='text-xs text-center text-blue-600'>Static content renders normally</p>
              </div>
            </div>

            {/* CSS Transform Animations */}
            <div className='bg-linear-to-br from-emerald-50 to-teal-50 border-2 border-emerald-200 rounded-xl p-6 shadow-sm'>
              <div className='flex items-center justify-between mb-5'>
                <h3 className='text-base font-semibold text-emerald-900'>CSS Animations (CSS transforms)</h3>
                
                <span className='text-xs px-2.5 py-1 rounded-full border bg-emerald-100 text-emerald-700 border-emerald-300 font-medium'>
                  Always Works
                </span>
              </div>
              <p className='text-sm text-emerald-900 leading-relaxed mb-4 font-medium'>
                It worked because it was using compositor thread, not on the main thread.
              </p>
              <div className='relative h-32 bg-white/60 rounded-lg overflow-hidden border-2 border-emerald-200'>
                <div className='absolute inset-0 flex items-center justify-center'>
                  <div className='w-8 h-8 border-4 border-blue-200 border-t-blue-500 rounded-full animate-spin'></div>
                  <div className='w-6 h-6 bg-orange-500 rounded-full animate-bounce absolute ml-16'></div>
                  <div className='w-7 h-7 bg-purple-500 rounded animate-pulse absolute mr-16'></div>
                </div>
              </div>
              <p className='text-xs text-center text-emerald-600 mt-4'>CSS animations continue during encoding</p>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
