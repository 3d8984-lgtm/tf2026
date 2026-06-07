# PiD GPU Worker (RunPod Serverless)

NVIDIA **PiD (Pixel-aware Image Diffusion)** 업스케일러를 RunPod Serverless에 배포하는 컨테이너입니다.
Lovable Cloud의 `photoroom-upscale` Edge Function이 이 엔드포인트를 호출해 업스케일 결과 PNG를 받아옵니다.

- 모델: <https://github.com/nv-tlabs/PiD>
- 라이선스: Apache License 2.0 (상업적 이용 가능, NVIDIA copyright 고지 필요)

---

## 1. RunPod 계정 준비

1. <https://runpod.io> 가입
2. **Settings → API Keys**에서 API Key 발급 (Lovable Cloud Secrets `PID_API_KEY`로 등록)
3. **결제 수단 등록** (Serverless는 사용량 과금)

## 2. 컨테이너 빌드 & 푸시

Docker Hub 또는 GitHub Container Registry를 사용합니다.

```bash
cd gpu-worker

# 빌드 (PiD 모델 가중치는 빌드 단계에서 다운로드됨)
docker build -t <yourname>/pid-upscaler:latest .

# 푸시
docker push <yourname>/pid-upscaler:latest
```

> 빌드 환경에 NVIDIA GPU가 없어도 됩니다. RunPod에서 실제 GPU로 실행됩니다.

## 3. RunPod Serverless 엔드포인트 생성

1. RunPod 콘솔 → **Serverless → New Endpoint**
2. 설정:
   - **Container Image**: `<yourname>/pid-upscaler:latest`
   - **GPU**: `RTX A5000` 또는 `RTX 4090` (24GB) 권장
   - **Container Disk**: 20 GB
   - **Min Workers**: 0 (콜드 스타트 허용 / 비용 ↓)
   - **Max Workers**: 3
   - **Idle Timeout**: 5초
   - **Request Timeout**: 120초
3. 배포 후 발급된 **Endpoint ID** 확인
4. 호출 URL:
   ```
   https://api.runpod.ai/v2/<endpoint_id>/runsync
   ```
   이 URL을 Lovable Cloud Secrets `PID_ENDPOINT_URL` 로 등록

## 4. 요청 / 응답 포맷

### Request (POST, header `Authorization: Bearer <PID_API_KEY>`)
```json
{
  "input": {
    "image_b64": "iVBORw0KGgo...",
    "scale": 2,
    "kind": "auto"
  }
}
```

### Response
```json
{
  "output": {
    "image_b64": "iVBORw0KGgo...",
    "width": 2048,
    "height": 2048,
    "model": "PiD-v1"
  }
}
```

## 5. 헬스 체크

```bash
curl -X POST https://api.runpod.ai/v2/<endpoint_id>/runsync \
  -H "Authorization: Bearer <PID_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"input":{"ping":true}}'
```
→ `{"output":{"ok":true,"model":"PiD-v1"}}` 가 와야 정상.

---

## 비용 가이드

| GPU | 단가(약) | 1장 추론(2×, 1024px) | 1만장 비용 |
|---|---|---|---|
| RTX A5000 | $0.00026/초 | ~3초 | ~$7.8 |
| RTX 4090 | $0.00031/초 | ~1.5초 | ~$4.7 |

> Min Workers=0으로 두면 유휴 시 비용 $0. 콜드 스타트(15~30초) 1회 발생.
