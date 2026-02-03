// Mock S3Service for tests
// Never let tests touch AWS S3

import { S3Service } from "../../src/s3/s3.service";

export const mockS3Service: Partial<S3Service> = {
  createUploadUrl: jest.fn().mockResolvedValue({
    uploadUrl: "https://test-bucket.s3.amazonaws.com/test-key",
    key: "test-key",
    fileUrl: "https://test-bucket.s3.amazonaws.com/test-key",
  }),
  deleteObject: jest.fn().mockResolvedValue(undefined),
  // Ensure all methods are mocked to prevent any real AWS calls
  onModuleInit: jest.fn().mockResolvedValue(undefined),
};
