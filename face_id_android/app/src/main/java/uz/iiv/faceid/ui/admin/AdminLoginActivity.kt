package uz.iiv.faceid.ui.admin

import android.content.Intent
import android.os.Bundle
import android.view.View
import androidx.appcompat.app.AppCompatActivity
import uz.iiv.faceid.FaceIdApp
import uz.iiv.faceid.databinding.ActivityAdminLoginBinding
import uz.iiv.faceid.ui.add.AddPersonActivity
import uz.iiv.faceid.ui.settings.SettingsActivity

class AdminLoginActivity : AppCompatActivity() {

    private lateinit var binding: ActivityAdminLoginBinding

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityAdminLoginBinding.inflate(layoutInflater)
        setContentView(binding.root)

        val targetScreen = intent.getStringExtra("TARGET_SCREEN") ?: ""

        binding.btnCancelPin.setOnClickListener {
            finish()
        }

        binding.btnSubmitPin.setOnClickListener {
            val enteredPin = binding.etAdminPin.text.toString().trim()
            val correctPin = FaceIdApp.instance.settings.adminPin

            if (enteredPin == correctPin) {
                binding.tvPinError.visibility = View.GONE
                when (targetScreen) {
                    "ADD_PERSON" -> {
                        startActivity(Intent(this, AddPersonActivity::class.java))
                        finish()
                    }
                    "SETTINGS" -> {
                        startActivity(Intent(this, SettingsActivity::class.java))
                        finish()
                    }
                    else -> {
                        setResult(RESULT_OK)
                        finish()
                    }
                }
            } else {
                binding.tvPinError.visibility = View.VISIBLE
                binding.etAdminPin.text.clear()
            }
        }
    }
}
