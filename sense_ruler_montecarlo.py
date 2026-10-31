"""
《感觉尺》判定容差 Monte Carlo 推演
==================================
目的：模拟"玩家定性手感 + 松手延迟 + 手高偏差"三层误差叠加后，
      在当前容差下的真实通过率，并反推该定多宽。

所有人类相关参数均为 [PLACEHOLDER]，需 playtest 实测校准。
模型假设见各函数注释。
"""

import numpy as np

# ---------- 原型里的物理常量 ----------
GROW_L1 = 110.0   # 第1/2关放绳速度 px/s
GROW_L3 = 100.0   # 第3关放绳速度 px/s

# ---------- 关卡"目标中心长度" A（px），即我们希望玩家命中的绳长 ----------
A1 = 192.0                     # 直线桥：沟需≥170覆盖，舒适中心取192
R2 = 45.0                      # 圆围栏目标半径
A2 = 2 * np.pi * R2            # = 282.74 圆周长
S3 = 55.0                      # 方门目标边长
A3 = 4 * S3                    # = 220 方周长

# ---------- 原型当前容差（代码里的值，转成绳长 L 空间） ----------
cur_L1 = (170.0, 215.0)            # minPass / maxPass
cur_L2 = (2*np.pi*42.0, 2*np.pi*48.5)   # (263.89, 304.80)  r:42~48.5
cur_L3 = (4*51.5, 4*58.5)               # (206, 234)        A:51.5~58.5

# ---------- 玩家误差模型 ----------
# 玩家实际产出的绳长:
#   ropeLen = A*(1 + eps_p) + eps_d - net_bias
#   eps_p   : 感知乘性误差 ~ N(0, (σp*A)^2)  —— "定性不定量"，相对误差恒定
#   eps_d   : 松手延迟超放 = grow * τ, τ~N(μτ,στ) 夹在[0.05,0.30]s  —— 单向正偏
#   net_bias: 手高系统性欠放 = β*handH - grow*μτ  （手高错觉减去延迟超放后的净偏移）
#
# 稳态假设：玩家在同一关内学会了补偿 net_bias（偏差可学习），故调参时取 net_bias=0，
#          只剩零均值随机误差（eps_p + eps_d 随机部分）。这给出"熟练后"的通过率。
#          首试未补偿的通过率单独算，用来体现手高的"差一点"戏剧性。

def simulate(A, sigma_p, grow, mu_tau, sd_tau, handH, beta, band, N=300000, compensate=True):
    rng = np.random.default_rng(7)
    eps_p = rng.normal(0.0, sigma_p, N)   # 相对CV，A*(1+eps_p) 自然得到 std=A*sigma_p
    tau = np.clip(rng.normal(mu_tau, sd_tau, N), 0.05, 0.30)
    if compensate:
        # 稳态：玩家已学会补偿"手高错觉"与"延迟超放"两个系统性偏移
        # 只剩零均值随机误差（感知 + 延迟抖动）
        rope = A * (1 + eps_p) + grow * (tau - mu_tau)
    else:
        # 首试：手高错觉未补偿（β比例），延迟超放自然含其均值
        rope = A * (1 + eps_p) + grow * tau - beta * handH
    lo, hi = band
    return float(np.mean((rope >= lo) & (rope <= hi)))

def sigma_L(A, sigma_p, grow, sd_tau):
    """稳态（已补偿）下绳长分布的标准差"""
    return np.sqrt((sigma_p * A) ** 2 + (grow * sd_tau) ** 2)

# 逆正态 CDF（Acklam 近似），避免依赖 scipy
def inv_norm(p):
    a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
         1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00]
    b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
         6.680131188771972e+01, -1.328068155288572e+01]
    c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
         -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00]
    d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00]
    plow, phigh = 0.02425, 1 - 0.02425
    if p < plow:
        q = np.sqrt(-2 * np.log(p))
        return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / \
               ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1)
    elif p <= phigh:
        q = p - 0.5; r = q * q
        return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5]) * q / \
               (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1)
    else:
        q = np.sqrt(-2 * np.log(1 - p))
        return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / \
                ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1)

# ---------- 固定假设（全部 [PLACEHOLDER]，待 playtest 校准） ----------
MU_TAU, SD_TAU = 0.15, 0.04     # 松手反应延迟均值/标准差(s)
HANDH_CUR, HANDH_NEW = 55.0, 75.0   # 当前/建议手高(px)
BETA = 0.7                       # 手高错觉未被补偿的比例
SCEN = {'低 σp=0.07': 0.07, '中 σp=0.11': 0.11, '高 σp=0.15': 0.15}

print("=" * 70)
print("1) 当前容差下，稳态(已补偿)通过率 —— 按人类感知误差三档")
print("=" * 70)
print(f"{'感知误差':<12}{'L1 桥':>10}{'L2 圈':>10}{'L3 门':>10}")
for name, sp in SCEN.items():
    p1 = simulate(A1, sp, GROW_L1, MU_TAU, SD_TAU, HANDH_CUR, BETA, cur_L1)
    p2 = simulate(A2, sp, GROW_L1, MU_TAU, SD_TAU, HANDH_CUR, BETA, cur_L2)
    p3 = simulate(A3, sp, GROW_L3, MU_TAU, SD_TAU, HANDH_CUR, BETA, cur_L3)
    print(f"{name:<12}{p1:>9.1%}{p2:>10.1%}{p3:>10.1%}")

print()
print("=" * 70)
print("2) 手高抬到75px 后，首试(未补偿)通过率 —— 体现'差一点'戏剧性")
print("=" * 70)
print(f"{'感知误差':<12}{'L1 桥':>10}{'L2 圈':>10}{'L3 门':>10}")
for name, sp in SCEN.items():
    p1 = simulate(A1, sp, GROW_L1, MU_TAU, SD_TAU, HANDH_NEW, BETA, cur_L1, compensate=False)
    p2 = simulate(A2, sp, GROW_L1, MU_TAU, SD_TAU, HANDH_NEW, BETA, cur_L2, compensate=False)
    p3 = simulate(A3, sp, GROW_L3, MU_TAU, SD_TAU, HANDH_NEW, BETA, cur_L3, compensate=False)
    print(f"{name:<12}{p1:>9.1%}{p2:>10.1%}{p3:>10.1%}")

print()
print("=" * 70)
print("3) 反推容差：中档 σp=0.11，目标通过率 L1=85% L2=72% L3=62%")
print("   （难度递进＝后续关容差收窄；几何上 A 越大绝对误差也越大）")
print("=" * 70)
SP_MID = 0.11
TARGET = {'L1': 0.85, 'L2': 0.72, 'L3': 0.62}
levels = [('L1', A1, GROW_L1, sigma_L(A1, SP_MID, GROW_L1, SD_TAU)),
          ('L2', A2, GROW_L1, sigma_L(A2, SP_MID, GROW_L1, SD_TAU)),
          ('L3', A3, GROW_L3, sigma_L(A3, SP_MID, GROW_L3, SD_TAU))]
print(f"{'关':<5}{'σL':>7}{'半宽w':>8}{'相对容差':>10}  推荐参数")
for key, A, grow, sig in levels:
    tp = TARGET[key]
    z = inv_norm((1 + tp) / 2)
    w = z * sig
    lo, hi = A - w, A + w
    rel = w / A
    extra = ""
    if key == 'L1':
        extra = f"minPass={lo:.0f}  maxPass={hi:.0f}"
    elif key == 'L2':
        rc = A / (2*np.pi); rh = w / (2*np.pi)
        extra = f"提示圈r={rc:.1f}  minR={rc-rh:.1f}  maxR={rc+rh:.1f}"
    elif key == 'L3':
        sc = A / 4; sh = w / 4
        extra = f"minA={sc-sh:.1f}  maxA={sc+sh:.1f}  (doorS={S3})"
    print(f"{key:<5}{sig:>7.1f}{w:>8.1f}{rel:>9.1%}  {extra}")

print()
print("提示：延迟造成单向超放，故上界可再松20%、下界收紧20%（非对称），")
print("      在不改变总宽度的前提下进一步贴合'短了=失误/长了=贪心'的心理。")
