import path from "path";
import { Video } from "../entity/Video.js";
import { uploadFile } from "../helpers/blossom.js";
import { getMimeTypeByPath } from "../utils/utils.js";
import debug from "debug";
import { BlossomConfig } from "../types.js";

const logger = debug("novia:dvm:upload");

export async function uploadToBlossomServers(
  uploadServers: BlossomConfig[],
  video: Video,
  fullPaths: {
    videoPath: string;
    thumbPath: string;
    infoPath: string;
  },
  secretKey: Uint8Array,
  onProgress?: (server: BlossomConfig, percentCompleted: number, speedMBs: number) => Promise<void>,
  onError?: (msg: string) => Promise<void>,
) {
  for (const server of uploadServers) {
    if (video.mediaSize > server.maxUploadSizeMB * 1024 * 1024) {
      logger(
        `Can not upload to ${server.url} because video exceeds maxUploadSizeMB: ${video.mediaSize} > ${server.maxUploadSizeMB}MB`,
      );
      continue;
    }

    const resultTags: string[][] = [];

    try {
      const videoBlob = await uploadFile(
        fullPaths.videoPath,
        server.url,
        getMimeTypeByPath(fullPaths.videoPath),
        path.basename(fullPaths.videoPath),
        "Upload Video",
        secretKey,
        video.videoSha256,
        async (percentCompleted, speedMBs) => {
          if (onProgress) {
            await onProgress(server, percentCompleted, speedMBs);
          }
        },
      );
      logger(`Uploaded video file: ${videoBlob.url}`);
    } catch (err) {
      const msg = `Upload of video to ${server} failed.`;
      console.error(msg, err);
      onError && (await onError(msg));
    }

    try {
      const thumbBlob = await uploadFile(
        fullPaths.thumbPath,
        server.url,
        getMimeTypeByPath(fullPaths.thumbPath),
        path.basename(fullPaths.thumbPath),
        "Upload Thumbnail",
        secretKey,
        video.thumbSha256,
      );
      logger(`Uploaded thumbnail file: ${thumbBlob.url}`);
    } catch (err) {
      const msg = `Upload of tumbnails to ${server} failed.`;
      console.error(msg, err);
    }

    try {
      const infoBlob = await uploadFile(
        fullPaths.infoPath,
        server.url,
        getMimeTypeByPath(fullPaths.infoPath),
        path.basename(fullPaths.infoPath),
        "Upload info json",
        secretKey,
        video.infoSha256,
      );
      logger(`Uploaded info json file: ${infoBlob.url}`);
    } catch (err) {
      const msg = `Upload of info json to ${server} failed.`;
      console.error(msg, err);
    }
  }
}
