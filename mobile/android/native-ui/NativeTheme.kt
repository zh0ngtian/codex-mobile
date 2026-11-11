package com.app.pakeplus.nativeui

import android.app.Activity
import android.os.Build
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.DialogWindowProvider
import androidx.core.view.WindowCompat

private val LocalNativeDarkAppearance = staticCompositionLocalOf { false }

/** 主页面与弹层各自同步当前窗口；App 外观可以与系统外观不同。 */
@Composable
internal fun NativeSystemBarAppearance() {
    val view = LocalView.current
    val window = (view.parent as? DialogWindowProvider)?.window ?: (view.context as? Activity)?.window ?: return
    val dark = LocalNativeDarkAppearance.current
    val controller = remember(window) { WindowCompat.getInsetsController(window, window.decorView) }
    DisposableEffect(controller) {
        val status = controller.isAppearanceLightStatusBars
        val navigation = controller.isAppearanceLightNavigationBars
        onDispose {
            controller.isAppearanceLightStatusBars = status
            controller.isAppearanceLightNavigationBars = navigation
        }
    }
    SideEffect {
        controller.isAppearanceLightStatusBars = !dark
        controller.isAppearanceLightNavigationBars = !dark
    }
}

// 使用 Material 3 标准字阶和形状；页面通过语义角色选择层级，不再全局缩小默认字号。
private val NativeTypography = Typography()
private val NativeShapes = Shapes()

internal object NativeSpacing {
    val small = 8.dp
    val medium = 16.dp
    val large = 24.dp
    val touchTarget = 48.dp
}

internal object NativeMotion {
    const val short = 180
    const val medium = 300
    fun <T> spatial() = spring<T>(dampingRatio = 0.88f, stiffness = Spring.StiffnessMediumLow)
    fun <T> effects() = tween<T>(short)
}

@Composable
internal fun CodexMaterialTheme(appearance: String, fontScale: Float = 1f, content: @Composable () -> Unit) {
    val dark = when (appearance) { "light" -> false; "dark" -> true; else -> isSystemInDarkTheme() }
    val context = LocalContext.current
    val scheme = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        if (dark) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
    } else if (dark) NativeDarkColorScheme else NativeLightColorScheme
    val density = LocalDensity.current
    CompositionLocalProvider(LocalDensity provides Density(density.density, density.fontScale * fontScale),
        LocalNativeDarkAppearance provides dark) {
    MaterialTheme(colorScheme = scheme, typography = NativeTypography, shapes = NativeShapes) {
        NativeSystemBarAppearance()
        content()
    }
    }
}

// Material Color Utilities 0.3.0：沿用蓝色种子 #435E91，Tonal Spot、标准对比度。
// 完整生成配对角色，避免旧系统混用默认紫色的 onX / container。
internal val NativeLightColorScheme = lightColorScheme(
    primary = Color(0xFF435E91),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFFD7E2FF),
    onPrimaryContainer = Color(0xFF2A4678),
    inversePrimary = Color(0xFFACC7FF),
    secondary = Color(0xFF565E71),
    onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFFDAE2F9),
    onSecondaryContainer = Color(0xFF3F4759),
    tertiary = Color(0xFF715574),
    onTertiary = Color(0xFFFFFFFF),
    tertiaryContainer = Color(0xFFFBD7FC),
    onTertiaryContainer = Color(0xFF583E5B),
    background = Color(0xFFF9F9FF),
    onBackground = Color(0xFF1A1B20),
    surface = Color(0xFFF9F9FF),
    onSurface = Color(0xFF1A1B20),
    surfaceVariant = Color(0xFFE1E2EC),
    onSurfaceVariant = Color(0xFF44474F),
    surfaceTint = Color(0xFF435E91),
    inverseSurface = Color(0xFF2F3036),
    inverseOnSurface = Color(0xFFF0F0F7),
    error = Color(0xFFBA1A1A),
    onError = Color(0xFFFFFFFF),
    errorContainer = Color(0xFFFFDAD6),
    onErrorContainer = Color(0xFF93000A),
    outline = Color(0xFF74777F),
    outlineVariant = Color(0xFFC4C6D0),
    scrim = Color(0xFF000000),
    surfaceBright = Color(0xFFF9F9FF),
    surfaceDim = Color(0xFFD9D9E0),
    surfaceContainer = Color(0xFFEDEDF4),
    surfaceContainerHigh = Color(0xFFE8E7EE),
    surfaceContainerHighest = Color(0xFFE2E2E9),
    surfaceContainerLow = Color(0xFFF3F3FA),
    surfaceContainerLowest = Color(0xFFFFFFFF),
)

internal val NativeDarkColorScheme = darkColorScheme(
    primary = Color(0xFFACC7FF),
    onPrimary = Color(0xFF0F2F60),
    primaryContainer = Color(0xFF2A4678),
    onPrimaryContainer = Color(0xFFD7E2FF),
    inversePrimary = Color(0xFF435E91),
    secondary = Color(0xFFBEC6DC),
    onSecondary = Color(0xFF283041),
    secondaryContainer = Color(0xFF3F4759),
    onSecondaryContainer = Color(0xFFDAE2F9),
    tertiary = Color(0xFFDEBCDF),
    onTertiary = Color(0xFF402844),
    tertiaryContainer = Color(0xFF583E5B),
    onTertiaryContainer = Color(0xFFFBD7FC),
    background = Color(0xFF111318),
    onBackground = Color(0xFFE2E2E9),
    surface = Color(0xFF111318),
    onSurface = Color(0xFFE2E2E9),
    surfaceVariant = Color(0xFF44474F),
    onSurfaceVariant = Color(0xFFC4C6D0),
    surfaceTint = Color(0xFFACC7FF),
    inverseSurface = Color(0xFFE2E2E9),
    inverseOnSurface = Color(0xFF2F3036),
    error = Color(0xFFFFB4AB),
    onError = Color(0xFF690005),
    errorContainer = Color(0xFF93000A),
    onErrorContainer = Color(0xFFFFDAD6),
    outline = Color(0xFF8E9099),
    outlineVariant = Color(0xFF44474F),
    scrim = Color(0xFF000000),
    surfaceBright = Color(0xFF37393E),
    surfaceDim = Color(0xFF111318),
    surfaceContainer = Color(0xFF1E2025),
    surfaceContainerHigh = Color(0xFF282A2F),
    surfaceContainerHighest = Color(0xFF33353A),
    surfaceContainerLow = Color(0xFF1A1B20),
    surfaceContainerLowest = Color(0xFF0C0E13),
)
