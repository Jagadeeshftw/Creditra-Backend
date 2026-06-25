import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { errorHandler } from '../../middleware/errorHandler.js';

// Mock console.error to avoid test output pollution
const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

describe('errorHandler middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockRequest = {};
    mockResponse = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    mockNext = vi.fn();
    mockConsoleError.mockClear();
  });

  afterAll(() => {
    mockConsoleError.mockRestore();
  });

  it('should log error details', () => {
    const error = new Error('Test error');
    errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

    expect(mockConsoleError).toHaveBeenCalledWith('[errorHandler]', {
      message: 'Test error',
      stack: expect.any(String),
      name: 'Error',
    });
  });

  it('should handle generic errors with 500 status', () => {
    const error = new Error('Internal error');
    
    errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

    expect(mockResponse.status).toHaveBeenCalledWith(500);
    expect(mockResponse.json).toHaveBeenCalledWith({
      data: null,
      error: 'Internal server error',
    });
  });

  it('should handle ValidationError with 400 status', () => {
    const error = new Error('Validation failed');
    error.name = 'ValidationError';
    
    errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

    expect(mockResponse.status).toHaveBeenCalledWith(400);
    expect(mockResponse.json).toHaveBeenCalledWith({
      data: null,
      error: 'Validation failed',
    });
  });

  it('should handle NotFoundError with 404 status', () => {
    const error = new Error('Resource not found');
    error.name = 'NotFoundError';
    
    errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

    expect(mockResponse.status).toHaveBeenCalledWith(404);
    expect(mockResponse.json).toHaveBeenCalledWith({
      data: null,
      error: 'Resource not found',
    });
  });

  it('should handle UnauthorizedError with 401 status', () => {
    const error = new Error('Unauthorized access');
    error.name = 'UnauthorizedError';
    
    errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

    expect(mockResponse.status).toHaveBeenCalledWith(401);
    expect(mockResponse.json).toHaveBeenCalledWith({
      data: null,
      error: 'Unauthorized access',
    });
  });

  it('should handle ForbiddenError with 403 status', () => {
    const error = new Error('Access forbidden');
    error.name = 'ForbiddenError';
    
    errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

    expect(mockResponse.status).toHaveBeenCalledWith(403);
    expect(mockResponse.json).toHaveBeenCalledWith({
      data: null,
      error: 'Access forbidden',
    });
  });

  it('should handle string errors for 5xx status codes', () => {
    const error = 'Database connection failed';
    
    errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

    expect(mockResponse.status).toHaveBeenCalledWith(500);
    expect(mockResponse.json).toHaveBeenCalledWith({
      data: null,
      error: 'Database connection failed',
    });
  });

  it('should hide Error object details for 5xx status codes', () => {
    const error = new Error('Database connection failed');
    error.stack = 'Detailed stack trace';
    
    errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

    expect(mockResponse.status).toHaveBeenCalledWith(500);
    expect(mockResponse.json).toHaveBeenCalledWith({
      data: null,
      error: 'Internal server error', // Generic message, not the actual error
    });
  });

  it('should pass through Error objects for 4xx status codes', () => {
    const error = new Error('Invalid input data');
    error.name = 'ValidationError';
    
    errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

    expect(mockResponse.status).toHaveBeenCalledWith(400);
    expect(mockResponse.json).toHaveBeenCalledWith({
      data: null,
      error: 'Invalid input data', // Actual error message for client errors
    });
  });

  it('should handle unknown error types', () => {
    const error = { someProperty: 'some value' } as unknown;
    
    errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

    expect(mockResponse.status).toHaveBeenCalledWith(500);
    expect(mockResponse.json).toHaveBeenCalledWith({
      data: null,
      error: 'Internal server error',
    });
  });
});
