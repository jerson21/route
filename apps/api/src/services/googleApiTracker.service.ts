import { prisma } from '../config/database.js';
import { GoogleApiType, Prisma } from '@prisma/client';

// Google API pricing (USD per request/element)
const API_PRICING = {
  GEOCODING: 0.005,           // $5 per 1000
  DIRECTIONS: 0.005,          // $5 per 1000 (basic)
  DIRECTIONS_TRAFFIC: 0.01,   // $10 per 1000 (with traffic)
  DISTANCE_MATRIX: 0.005,     // $5 per 1000 elements
};

interface TrackingParams {
  apiType: GoogleApiType;
  endpoint: string;
  requestParams: Record<string, unknown>;
  responseStatus: string;
  httpStatus: number;
  responseTimeMs: number;
  elementCount?: number;
  routeId?: string;
  userId?: string;
  source?: string;
  useTraffic?: boolean;
}

/**
 * Calculate estimated cost for a Google API call
 */
export function calculateApiCost(
  apiType: GoogleApiType,
  elementCount: number = 1,
  useTraffic: boolean = false
): number {
  switch (apiType) {
    case 'GEOCODING':
      return API_PRICING.GEOCODING;
    case 'DIRECTIONS':
      return useTraffic ? API_PRICING.DIRECTIONS_TRAFFIC : API_PRICING.DIRECTIONS;
    case 'DISTANCE_MATRIX':
      return API_PRICING.DISTANCE_MATRIX * elementCount;
    default:
      return 0;
  }
}

/**
 * Track a Google API call (async, non-blocking)
 */
export function trackGoogleApiCall(params: TrackingParams): void {
  const cost = calculateApiCost(
    params.apiType,
    params.elementCount || 1,
    params.useTraffic
  );

  // Fire and forget - don't block the main flow
  prisma.googleApiUsage.create({
    data: {
      apiType: params.apiType,
      endpoint: params.endpoint,
      requestParams: params.requestParams as Prisma.InputJsonValue,
      responseStatus: params.responseStatus,
      httpStatus: params.httpStatus,
      responseTimeMs: params.responseTimeMs,
      elementCount: params.elementCount || 1,
      estimatedCost: new Prisma.Decimal(cost),
      routeId: params.routeId,
      userId: params.userId,
      source: params.source,
    }
  }).catch(err => {
    console.error('[GoogleApiTracker] Error tracking API call:', err);
  });
}

/**
 * Get usage statistics for a date range
 */
export async function getUsageStats(startDate: Date, endDate: Date, apiType?: GoogleApiType) {
  const where: Prisma.GoogleApiUsageWhereInput = {
    createdAt: {
      gte: startDate,
      lte: endDate,
    },
    ...(apiType && { apiType }),
  };

  const [totals, byApiType] = await Promise.all([
    prisma.googleApiUsage.aggregate({
      where,
      _count: true,
      _sum: {
        estimatedCost: true,
        elementCount: true,
      },
      _avg: {
        responseTimeMs: true,
      },
    }),
    prisma.googleApiUsage.groupBy({
      by: ['apiType'],
      where,
      _count: true,
      _sum: {
        estimatedCost: true,
      },
    }),
  ]);

  const byApiTypeMap: Record<string, { calls: number; cost: number }> = {};
  for (const item of byApiType) {
    byApiTypeMap[item.apiType] = {
      calls: item._count,
      cost: Number(item._sum.estimatedCost) || 0,
    };
  }

  return {
    totalCalls: totals._count,
    totalCost: Number(totals._sum.estimatedCost) || 0,
    totalElements: totals._sum.elementCount || 0,
    avgResponseTime: Math.round(totals._avg.responseTimeMs || 0),
    byApiType: byApiTypeMap,
  };
}

/**
 * Get daily usage for charts
 */
export async function getDailyUsage(startDate: Date, endDate: Date, apiType?: GoogleApiType) {
  const where: Prisma.GoogleApiUsageWhereInput = {
    createdAt: {
      gte: startDate,
      lte: endDate,
    },
    ...(apiType && { apiType }),
  };

  // Get raw data and aggregate in memory (Prisma doesn't support date truncation in groupBy)
  const records = await prisma.googleApiUsage.findMany({
    where,
    select: {
      createdAt: true,
      estimatedCost: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  // Group by date
  const dailyMap: Record<string, { calls: number; cost: number }> = {};

  for (const record of records) {
    const dateKey = record.createdAt.toISOString().split('T')[0];
    if (!dailyMap[dateKey]) {
      dailyMap[dateKey] = { calls: 0, cost: 0 };
    }
    dailyMap[dateKey].calls++;
    dailyMap[dateKey].cost += Number(record.estimatedCost);
  }

  return Object.entries(dailyMap).map(([date, data]) => ({
    date,
    calls: data.calls,
    cost: Math.round(data.cost * 1000) / 1000, // Round to 3 decimals
  }));
}

/**
 * Get paginated usage logs
 */
export async function getUsageLogs(
  page: number,
  limit: number,
  filters: {
    startDate?: Date;
    endDate?: Date;
    apiType?: GoogleApiType;
    routeId?: string;
  }
) {
  const where: Prisma.GoogleApiUsageWhereInput = {};

  if (filters.startDate || filters.endDate) {
    where.createdAt = {};
    if (filters.startDate) where.createdAt.gte = filters.startDate;
    if (filters.endDate) where.createdAt.lte = filters.endDate;
  }
  if (filters.apiType) where.apiType = filters.apiType;
  if (filters.routeId) where.routeId = filters.routeId;

  const [data, total] = await Promise.all([
    prisma.googleApiUsage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.googleApiUsage.count({ where }),
  ]);

  return {
    data: data.map(record => ({
      ...record,
      estimatedCost: Number(record.estimatedCost),
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/**
 * Get quick stats for today, this week, and this month
 */
export async function getQuickStats() {
  const now = new Date();

  // Start of today
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  // Start of week (Monday)
  const startOfWeek = new Date(now);
  const dayOfWeek = startOfWeek.getDay();
  const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  startOfWeek.setDate(startOfWeek.getDate() - diff);
  startOfWeek.setHours(0, 0, 0, 0);

  // Start of month
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [today, week, month] = await Promise.all([
    prisma.googleApiUsage.aggregate({
      where: { createdAt: { gte: startOfToday } },
      _count: true,
      _sum: { estimatedCost: true },
    }),
    prisma.googleApiUsage.aggregate({
      where: { createdAt: { gte: startOfWeek } },
      _count: true,
      _sum: { estimatedCost: true },
    }),
    prisma.googleApiUsage.aggregate({
      where: { createdAt: { gte: startOfMonth } },
      _count: true,
      _sum: { estimatedCost: true },
    }),
  ]);

  return {
    today: {
      calls: today._count,
      cost: Number(today._sum.estimatedCost) || 0,
    },
    week: {
      calls: week._count,
      cost: Number(week._sum.estimatedCost) || 0,
    },
    month: {
      calls: month._count,
      cost: Number(month._sum.estimatedCost) || 0,
    },
  };
}
