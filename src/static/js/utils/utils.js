/**
 * @fileoverview Utility functions for the application.
 */

/**
 * Converts a Blob to a JSON object.
 *
 * @param {Blob} blob - The Blob to convert.
 * @returns {Promise<Object>} A promise that resolves with the JSON object.
 * @throws {string} Throws an error if the Blob cannot be parsed to JSON.
 */
export function blobToJSON(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            console.log('FileReader result:', reader.result);
            if (reader.result) {
                try {
                    const json = JSON.parse(reader.result);
                    console.log('Parsed JSON:', json);
                    resolve(json);
                } catch (e) {
                    console.error('Could not parse JSON', reader.result, e);
                    reject(e);
                }
            } else {
                reject('Failed to parse blob to JSON');
            }
        };
        reader.onerror = () => {
            reject('FileReader error');
        };
        reader.readAsText(blob);
    });
}

/**
 * Converts a base64 string to an ArrayBuffer.
 *
 * @param {string} base64 - The base64 string to convert.
 * @returns {ArrayBuffer} The ArrayBuffer.
 */
export function base64ToArrayBuffer(base64) {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
} 
