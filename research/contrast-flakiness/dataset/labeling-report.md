# 명도 대비 오탐 실험 — 라벨링 리포트 (파일럿)

조건: base=RM꺼짐·폰트차단 / rm=RM켜짐·폰트차단(현행) / font=RM꺼짐·폰트허용 / rm+font=RM켜짐·폰트허용
라벨 기준: 해당 요소의 **안정 상태(애니메이션 종료·실제 폰트)** 대비가 기준(일반 4.5:1, 대형 3:1)을 충족하면 → 자동 보고는 **오탐**. 충족하지 못하면 **진탐**.

| 사이트 | base | rm | font | rm+font |
|---|---|---|---|---|
| site-CS | 실패 | 실패 | 실패 | 실패 |
| site-BI | 0 | 0 | 0 | 0 |
| site-AH | 19 | 19 | 19 | 19 |
| site-AR | 4 | 4 | 4 | 4 |
| site-CH | 0 | 0 | 0 | 0 |
| site-CJ | 실패 | 실패 | 실패 | 실패 |
| site-AM | 4 | 8 | 2 | 2 |
| site-V | 1 | 1 | 1 | 1 |
| site-DE | 2 | 2 | 2 | 2 |
| site-AP | 0 | 0 | 0 | 0 |
| site-AE | 3 | 3 | 3 | 3 |
| site-L | 3 | 3 | 2 | 2 |
| site-BV | 0 | 0 | 0 | 0 |
| site-BX | 5 | 5 | 5 | 5 |
| site-BU | 0 | 0 | 0 | 0 |
| site-BE | 18 | 18 | 16 | 16 |
| site-CD | 0 | 0 | 0 | 0 |
| site-AA | 0 | 0 | 0 | 0 |
| site-BD | 11 | 11 | 11 | 11 |
| site-DN | 21 | 21 | 21 | 21 |
| site-DK | 190 | 190 | 190 | 192 |
| site-BL | 0 | 0 | 6 | 1 |
| site-DJ | 77 | 79 | 72 | 80 |
| site-BS | 1 | 1 | 1 | 1 |

## site-AM
### 폰트 허용으로 사라진 위반 (폰트 폴백 기인 오탐 후보) (2건)
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 4/5
  - 색상 #407fd7 on #ecf4ff (대비 3.62), 10.5pt (14px) / weight normal · 캡처 shots 참조: shots/site-AM/base/1.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 5/5
  - 색상 #d85b54 on #ffeae8 (대비 3.28), 10.5pt (14px) / weight normal · 캡처 shots 참조: shots/site-AM/base/3.jpg
  - `(생략)`
### RM 적용 시 새로 생긴 위반 (미탐 위험 점검) (4건)
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 3/5
  - 색상 #7e7e7e on #ffffff (대비 4.05), 12.0pt (16px) / weight normal · 캡처 shots 참조: shots/site-AM/rm/1.jpg
  - `<div class="desc">
			                        시민 여러분들께서 인천 곳곳의 역사, 문화, 경제, 산업시설을 직접 견학하고 체험하는 프로그랩입니다.</div>`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 3/5
  - 색상 #7e7e7e on #ffffff (대비 4.05), 12.0pt (16px) / weight normal · 캡처 shots 참조: shots/site-AM/rm/3.jpg
  - `<div class="desc">
			                        각종 재난.사고로 사망 또는 후유장애를 입은 시민에게 보험사를 통해 보험금을 지급하는 제도</div>`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 3/5
  - 색상 #7e7e7e on #ffffff (대비 4.05), 12.0pt (16px) / weight normal · 캡처 shots 참조: shots/site-AM/rm/5.jpg
  - `<div class="desc">
			                        인천시민을 대상으로 임신·출산에 대한 정보 제공 등 보건·의료서비스 지원을 목적으로 합니다.</div>`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 3/5
  - 색상 #7e7e7e on #ffffff (대비 4.05), 12.0pt (16px) / weight normal · 캡처 shots 참조: shots/site-AM/rm/7.jpg
  - `<div class="desc">
			                        청년 면접비용 부담을 줄이고, 취업 자신감을 높이기 위해 취업 최종 관문인 면접 통과를 위한 면접용 정장 대여와 면접이미지컨설팅 지원</div>`

## site-L
### 폰트 허용으로 사라진 위반 (폰트 폴백 기인 오탐 후보) (1건)
- [ ] 오탐 / [ ] 진탐 — `.search-keyword-index` · 발생률 5/5
  - 색상 #7c7c7c on #ffffff (대비 4.17), 15.0pt (20px) / weight normal · 캡처 shots 참조: shots/site-L/base/0.jpg
  - `(생략)`

## site-BE
### 폰트 허용으로 사라진 위반 (폰트 폴백 기인 오탐 후보) (2건)
- [ ] 오탐 / [ ] 진탐 — `.tooltip` · 발생률 2/5
  - 색상 #272e3c on #000919 (대비 1.46), 10.5pt (14px) / weight normal · 캡처 shots 참조: shots/site-BE/base/0.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `.tooltip > b` · 발생률 2/5
  - 색상 #272e3c on #000919 (대비 1.46), 10.5pt (14px) / weight bold · 캡처 shots 참조: shots/site-BE/base/1.jpg
  - `<b>한전ON</b>`

## site-BL
### 폰트 허용 시 새로 생긴 위반 (미탐 위험 점검) (6건)
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 1/5
  - 색상 #7a7a7a on #ffffff (대비 4.29), 10.5pt (14px) / weight normal · 캡처 shots 참조: shots/_skip/0.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 1/5
  - 색상 #7a7a7a on #ffffff (대비 4.29), 10.5pt (14px) / weight normal · 캡처 shots 참조: shots/_skip/1.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 1/5
  - 색상 #7a7a7a on #ffffff (대비 4.29), 10.5pt (14px) / weight normal · 캡처 shots 참조: shots/_skip/2.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 1/5
  - 색상 #7a7a7a on #ffffff (대비 4.29), 10.5pt (14px) / weight normal · 캡처 shots 참조: shots/_skip/3.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 1/5
  - 색상 #7a7a7a on #ffffff (대비 4.29), 10.5pt (14px) / weight normal · 캡처 shots 참조: shots/_skip/4.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `.rounded-2\.5xl` · 발생률 1/5
  - 색상 #949494 on #ffffff (대비 3.03), 7.5pt (10px) / weight normal · 캡처 shots 참조: shots/_skip/5.jpg
  - `(생략)`

## site-DJ
### RM 적용으로 사라진 위반 (애니메이션 기인 오탐 후보) (8건)
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 1/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 1/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 1/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 1/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 1/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 1/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 1/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 1/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
### 폰트 허용으로 사라진 위반 (폰트 폴백 기인 오탐 후보) (15건)
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 3/5
  - 색상 #6699cc on #ffffff (대비 3), 9.0pt (12px) / weight normal · 캡처 shots 참조: shots/site-DJ/base/4.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 3/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal · 캡처 shots 참조: shots/site-DJ/base/5.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 3/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal · 캡처 shots 참조: shots/site-DJ/base/6.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 3/5
  - 색상 #6699cc on #ffffff (대비 3), 9.0pt (12px) / weight normal · 캡처 shots 참조: shots/site-DJ/base/7.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 3/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal · 캡처 shots 참조: shots/site-DJ/base/8.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 3/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal · 캡처 shots 참조: shots/site-DJ/base/9.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 3/5
  - 색상 #6699cc on #ffffff (대비 3), 9.0pt (12px) / weight normal · 캡처 shots 참조: shots/site-DJ/base/10.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 3/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal · 캡처 shots 참조: shots/site-DJ/base/11.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 3/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal · 캡처 shots 참조: shots/site-DJ/base/12.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 3/5
  - 색상 #6699cc on #ffffff (대비 3), 9.0pt (12px) / weight normal · 캡처 shots 참조: shots/site-DJ/base/13.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 3/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal · 캡처 shots 참조: shots/site-DJ/base/14.jpg
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 3/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 2/5
  - 색상 #6699cc on #ffffff (대비 3), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 2/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 2/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
### RM 적용 시 새로 생긴 위반 (미탐 위험 점검) (10건)
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 3/5
  - 색상 #6699cc on #ffffff (대비 3), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 3/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 3/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 1/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 1/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 1/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 1/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 1/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 1/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 1/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
### 폰트 허용 시 새로 생긴 위반 (미탐 위험 점검) (10건)
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 3/5
  - 색상 #6699cc on #ffffff (대비 3), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 3/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 3/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 2/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 2/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 2/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 2/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 2/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 2/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`
- [ ] 오탐 / [ ] 진탐 — `(생략)` · 발생률 2/5
  - 색상 #999999 on #ffffff (대비 2.84), 9.0pt (12px) / weight normal
  - `(생략)`

