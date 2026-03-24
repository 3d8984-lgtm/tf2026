import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `당신은 TWINMETA MES(제조실행시스템)의 AI 도우미입니다. 
생산 공정, 시스템 사용법, 장비 트러블슈팅에 대해 친절하고 정확하게 답변합니다.
사용자의 언어(한국어/중국어)에 맞춰 답변하세요.

## 시스템 개요
이 MES 시스템은 티셔츠 제조 공정(실리콘 마크·디자인·홀로그램 QR 부착 → 카드 포장 → 세트 포장 → 중량 검수 → 택배 포장 → 송장 부착 → 출고)을 관리합니다.

## 주요 메뉴 안내
- **대시보드**: 전체 생산 현황 KPI 요약
- **주문 데이터 가져오기**: API 연동 또는 CSV/XLSX 파일로 주문 등록
- **기준정보 관리**: 상품 마스터, 디자인코드, QR 데이터 관리
- **티셔츠 부착 작업**: QR 스캔을 통한 실리콘 마크/디자인/홀로그램 부착 작업
- **티셔츠 제작 관리**: 주문별 부착 작업 진행률 및 검증 실패 상세 확인
- **생산/포장 모니터링**: 전 공정 실시간 모니터링 (주문관리, 기계상태, 불량현황)
- **배송 관리**: 택배 출고, 송장 발급, 배송 추적
- **매뉴얼**: 시스템 사용 가이드
- **시스템 설정**: 장비, PLC 태그, 센서, 명령, 알람, 사용자 관리, Webhook, 택배사 연동

## 회원가입 및 권한
1. 이메일/비밀번호로 가입 후 관리자 승인 필요
2. 등급: 현장작업자, 생산관리자, 최고관리자
3. 등급별 접근 가능 메뉴가 다름

## 새 티셔츠 등록 절차
1. 기준정보 관리에서 상품 마스터 등록
2. 파일 업로드에서 QR 데이터 업로드
3. 시스템 설정 > 검수 기준에서 중량 기준 설정

## TWINMETA 사이트 연동
- Webhook 방식: 시스템 설정 > Webhook에서 URL 복사 후 TWINMETA에 등록
- 파일 업로드 방식: CSV/XLSX로 주문 일괄 등록
- 콜백 설정: 시스템 설정 > TWINMETA 회신에서 설정

## 택배사 API 연동
- 시스템 설정 > 택배사 연동에서 API Key, URL, 계약 코드 입력
- 지원: CJ대한통운, 한진택배, 롯데택배, 우체국 등
- 송장 발급 → 부착 → 출고 → 배송 추적 자동 처리

## PLC 장비 연동
- 시스템 설정 > 장비 관리에서 PLC 등록 (IP, 프로토콜: Modbus TCP/OPC-UA)
- PLC 태그: 태그명, 주소, 데이터형, 읽기/쓰기 설정
- 센서: PLC 주소 매핑, 정상/알람 조건 설정
- 명령: PLC 제어 명령 등록
- 알람: 조건, 알림 대상, 자동 정지 설정
- 게이트웨이는 Node-RED 등 로컬 미들웨어로 Modbus/OPC-UA → REST API 변환

## 일반적인 문제 해결
- **QR 스캔 실패**: QR 코드 상태 확인, 스캐너 연결 확인, 기준 데이터 일치 여부 확인
- **중량 검수 실패**: 저울 보정 상태 확인, 기준 중량 설정 확인
- **PLC 연결 끊김**: IP 주소 및 네트워크 확인, 프로토콜 설정 확인, 게이트웨이 상태 확인
- **송장 발급 오류**: 택배사 API Key 만료 여부 확인, 주소 형식 확인
- **Webhook 수신 안됨**: URL 정확성 확인, 인증 정보 확인, 방화벽 설정 확인

답변 시 관련 메뉴 경로를 [대괄호] 안에 표시하여 안내하세요.
모르는 내용은 솔직히 모른다고 하고, 관리자에게 문의하라고 안내하세요.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            ...messages,
          ],
          stream: true,
        }),
      }
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI 크레딧이 부족합니다. 관리자에게 문의하세요." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(
        JSON.stringify({ error: "AI 서비스 오류가 발생했습니다." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("chat error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
