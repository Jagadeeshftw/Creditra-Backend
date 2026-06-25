import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');

// Test configuration
export const options = {
  stages: [
    { duration: '30s', target: 10 },  // Ramp up to 10 users over 30s
    { duration: '1m', target: 10 },   // Stay at 10 users for 1 minute
    { duration: '10s', target: 0 },   // Ramp down to 0 users
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% of requests must complete below 500ms
    http_req_failed: ['rate<0.05'],   // Error rate must be below 5%
    errors: ['rate<0.05'],            // Custom error rate below 5%
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export default function () {
  // Test 1: Health check
  let healthRes = http.get(`${BASE_URL}/health`);
  check(healthRes, {
    'health status is 200': (r) => r.status === 200,
    'health response has status ok': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.data?.status === 'ok';
      } catch {
        return false;
      }
    },
  }) || errorRate.add(1);

  sleep(0.5);

  // Test 2: List credit lines
  let listRes = http.get(`${BASE_URL}/api/credit/lines?offset=0&limit=10`);
  check(listRes, {
    'list credit lines status is 200': (r) => r.status === 200,
    'list response has creditLines array': (r) => {
      try {
        const body = JSON.parse(r.body);
        return Array.isArray(body.data?.creditLines);
      } catch {
        return false;
      }
    },
  }) || errorRate.add(1);

  sleep(0.5);

  // Test 3: Risk evaluation
  const riskPayload = JSON.stringify({
    walletAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  });

  const riskParams = {
    headers: {
      'Content-Type': 'application/json',
    },
  };

  let riskRes = http.post(`${BASE_URL}/api/risk/evaluate`, riskPayload, riskParams);
  check(riskRes, {
    'risk evaluate status is 200': (r) => r.status === 200,
    'risk response has walletAddress': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.data?.walletAddress !== undefined;
      } catch {
        return false;
      }
    },
  }) || errorRate.add(1);

  sleep(1);
}
