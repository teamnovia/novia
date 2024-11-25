import { finalizeEvent } from "nostr-tools";
import { createReadStream, statSync } from "fs";
import axios from "axios";
import debug from "debug";

import { readFile } from "fs/promises";
import { createHash } from "crypto";

const logger = debug("novia:blossom");
export const BLOSSOM_AUTH_KIND = 24242;

export type BlobDescriptor = {
  created: number;
  type?: string;
  sha256: string;
  size: number;
  url: string;
};

const now = () => Math.floor(Date.now() / 1000);

const tenMinutesFromNow = () => now() + 10 * 60;

function createBlossemUploadAuthToken(
  size: number,
  blobHash: string,
  name: string,
  description: string,
  secretKey: Uint8Array
): string {
  const authEvent = {
    created_at: now(),
    kind: BLOSSOM_AUTH_KIND,
    content: "Upload thumbail",
    tags: [
      ["t", "upload"],
      ["size", `${size}`],
      ["x", blobHash],
      ["name", `thumb_${Math.random().toString(36).substring(2)}.jpg`], // make sure the auth events are unique
      ["expiration", `${tenMinutesFromNow()}`],
    ],
  };
  const signedEvent = finalizeEvent(authEvent, secretKey);
  logger(JSON.stringify(signedEvent));
  return btoa(JSON.stringify(signedEvent));
}

function createBlossemListAuthToken(secretKey: Uint8Array): string {
  const authEvent = {
    created_at: now(),
    kind: BLOSSOM_AUTH_KIND,
    content: "List Blobs",
    tags: [
      ["t", "list"],
      ["expiration", `${tenMinutesFromNow()}`],
    ],
  };
  const signedEvent = finalizeEvent(authEvent, secretKey);
  return btoa(JSON.stringify(signedEvent));
}

function createBlossemDeleteAuthToken(
  blobHash: string,
  secretKey: Uint8Array
): string {
  const authEvent = {
    created_at: now(),
    kind: BLOSSOM_AUTH_KIND,
    content: "Delete Blob",
    tags: [
      ["t", "delete"],
      ["x", blobHash],
      ["expiration", `${tenMinutesFromNow()}`],
    ],
  };
  const signedEvent = finalizeEvent(authEvent, secretKey);
  return btoa(JSON.stringify(signedEvent));
}

/*
export function decodeBlossemAuthToken(encodedAuthToken: string) {
  try {
    return JSON.parse(atob(encodedAuthToken).toString()) as SignedEvent;
  } catch (e: any) {
    logger("Failed to extract auth token ", encodedAuthToken);
  }
}
*/
async function calculateSHA256(filePath: string): Promise<string> {
  try {
    const fileBuffer = await readFile(filePath);
    const hash = createHash("sha256");
    hash.update(fileBuffer);
    return hash.digest("hex");
  } catch (error: any) {
    throw new Error(`Fehler beim Berechnen des SHA-256-Hash: ${error.message}`);
  }
}

export async function uploadFile(
  filePath: string,
  server: string,
  mimeType: string,
  name: string,
  actionDescription: string,
  secretKey: Uint8Array,
  hash?: string
): Promise<BlobDescriptor> {
  try {
    const stat = statSync(filePath);

    hash = hash || (await calculateSHA256(filePath));

    try {
    const test = await axios.head(`${server}/${hash}`);
    if (test.status == 200) {
      logger('File already exists. No upload needed.');
      // Return dummy blob descriptor
      return {
        url: `${server}/${hash}`,
        created: now(),
        sha256: hash,
        size: stat.size,
      };
    }
  } catch (error) {
    // Ignore error, due to 404 or similar
  }

    const blossomAuthToken = createBlossemUploadAuthToken(
      stat.size,
      hash,
      name,
      actionDescription,
      secretKey
    );

    // Create a read stream for the thumbnail file
    const thumbnailStream = createReadStream(filePath);

    // Upload thumbnail stream using axios
    const blob = await axios.put<BlobDescriptor>(
      `${server}/upload`,
      thumbnailStream,
      {
        headers: {
          "Content-Type": mimeType,
          Authorization: "Nostr " + blossomAuthToken,
        },
      }
    );

    logger(`File ${filePath} uploaded successfully.`);
    return blob.data;
  } catch (error: any) {
    throw new Error(
      `Failed to upload thumbnail ${filePath} to ${server}: ${
        error.message
      } (${JSON.stringify(error.response?.data)})`
    );
  }
}

export async function listBlobs(
  server: string,
  pubkey: string,
  secretKey: Uint8Array
): Promise<BlobDescriptor[]> {
  const authToken = createBlossemListAuthToken(secretKey);
  const blobResult = await axios.get<BlobDescriptor[]>(
    `${server}/list/${pubkey}`,
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: "Nostr " + authToken,
      },
    }
  );
  if (blobResult.status !== 200) {
    logger(
      `Failed to list blobs: ${blobResult.status} ${blobResult.statusText}`
    );
  }
  return blobResult.data;
}

export async function deleteBlob(
  server: string,
  blobHash: string,
  secretKey: Uint8Array
): Promise<void> {
  const authToken = createBlossemDeleteAuthToken(blobHash, secretKey);
  const blobResult = await axios.delete(`${server}/${blobHash}`, {
    headers: {
      Authorization: "Nostr " + authToken,
    },
  });
  if (blobResult.status !== 200) {
    logger(
      `Failed to delete blobs: ${blobResult.status} ${blobResult.statusText}`
    );
  }
}
